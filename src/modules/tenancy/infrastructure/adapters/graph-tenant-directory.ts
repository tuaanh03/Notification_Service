import { UpstreamError } from '../../../../shared/kernel/index.ts';
import type { DirectoryPerson, TenantDirectory } from '../../application/ports/index.ts';

export interface GraphDirectoryConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

type Fetch = typeof fetch;

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Graph trả tối đa 999 người một trang với `/users`. */
const PAGE_SIZE = 999;
/** Chặn vòng lặp vô tận nếu `@odata.nextLink` lỗi: 200 trang ≈ 200 nghìn người. */
const MAX_PAGES = 200;

interface GraphUser {
  id?: unknown;
  displayName?: unknown;
  mail?: unknown;
  userPrincipalName?: unknown;
  accountEnabled?: unknown;
  userType?: unknown;
}

/**
 * Đọc danh bạ tenant qua Microsoft Graph bằng client credentials (ADR-0027). Dùng chung app `GRAPH_*`
 * với việc gửi mail — app đó đã có quyền application `User.Read.All`.
 *
 * Lọc ở phía EWS (không dùng `$filter`): lọc `userType` trên Graph cần chế độ truy vấn nâng cao.
 * Lấy token mới mỗi lần gọi — đồng bộ hiếm khi chạy, không cần giữ token.
 *
 * Không log, không đưa vào message: secret, token, tên hay email của ai.
 */
export class GraphTenantDirectory implements TenantDirectory {
  readonly configured = true;
  readonly unavailableCode = 'M365_DIRECTORY_NOT_CONFIGURED';
  private readonly config: GraphDirectoryConfig;
  private readonly fetch: Fetch;

  constructor(deps: { config: GraphDirectoryConfig; fetch?: Fetch | undefined }) {
    this.config = deps.config;
    this.fetch = deps.fetch ?? fetch;
  }

  async listPeople(): Promise<DirectoryPerson[]> {
    const token = await this.accessToken();
    const people: DirectoryPerson[] = [];
    const select = 'id,displayName,mail,userPrincipalName,accountEnabled,userType';
    let next: string | null = `${GRAPH}/users?$select=${select}&$top=${PAGE_SIZE}`;
    for (let page = 0; next !== null; page += 1) {
      if (page >= MAX_PAGES) throw new UpstreamError('M365_DIRECTORY_ERROR', `directory has more than ${MAX_PAGES} pages`);
      const response = await this.call(next, { headers: { authorization: `Bearer ${token}` } });
      const body = (await response.json().catch(() => null)) as { value?: GraphUser[]; '@odata.nextLink'?: unknown } | null;
      if (!response.ok || !Array.isArray(body?.value)) {
        throw new UpstreamError('M365_DIRECTORY_ERROR', `Graph /users returned ${response.status}`);
      }
      for (const user of body.value) {
        const person = toPerson(user);
        if (person !== null) people.push(person);
      }
      next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null;
    }
    return people;
  }

  private async accessToken(): Promise<string> {
    const { tenantId, clientId, clientSecret } = this.config;
    const response = await this.call(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
    if (!response.ok || typeof body?.access_token !== 'string') {
      const error = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new UpstreamError('M365_DIRECTORY_ERROR', `token endpoint rejected the app: ${error}`);
    }
    return body.access_token;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new UpstreamError(
        'M365_DIRECTORY_ERROR',
        timedOut ? `Microsoft did not answer within ${this.config.timeoutMs} ms` : 'Microsoft Graph unreachable',
      );
    }
  }
}

/**
 * Bỏ: tài khoản đang tắt, khách mời (`Guest`, UPN có `#EXT#`), người không có địa chỉ email.
 * Email lấy `mail` trước, thiếu thì UPN — cùng thứ tự với claim `email` / `preferred_username` lúc đăng nhập.
 */
export function toPerson(user: GraphUser): DirectoryPerson | null {
  if (typeof user.id !== 'string' || user.id === '') return null;
  if (user.accountEnabled !== true || user.userType === 'Guest') return null;
  const upn = typeof user.userPrincipalName === 'string' && !user.userPrincipalName.includes('#EXT#') ? user.userPrincipalName : null;
  const email = [user.mail, upn].find((v): v is string => typeof v === 'string' && v.includes('@'));
  if (email === undefined) return null;
  const name = typeof user.displayName === 'string' && user.displayName.trim() !== '' ? user.displayName.trim() : null;
  return { oid: user.id, email, displayName: name };
}

/** Thiếu `GRAPH_*`, hoặc tenant của `GRAPH_*` khác tenant đăng nhập M365 (`oid` sẽ không khớp). */
export class DisabledTenantDirectory implements TenantDirectory {
  readonly configured = false;
  readonly unavailableCode: string;

  constructor(code: 'M365_DIRECTORY_NOT_CONFIGURED' | 'M365_DIRECTORY_TENANT_MISMATCH') {
    this.unavailableCode = code;
  }

  listPeople(): Promise<never> {
    return Promise.reject(new UpstreamError(this.unavailableCode, 'Microsoft 365 directory is not available', 503));
  }
}
