import type { Clock } from '../../../../shared/kernel/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import type { EmailProvider, EmailSendResult, OutgoingEmail } from '../../application/ports/index.ts';

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Mailbox gửi — `POST /users/{sender}/sendMail`. */
  sender: string;
  timeoutMs: number;
}

type Fetch = typeof fetch;

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Làm mới token trước khi hết hạn 5 phút — tránh token chết giữa lúc gửi. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** Lỗi mạng chắc chắn xảy ra TRƯỚC khi request tới được Microsoft (không phân giải / không kết nối được). */
const NOT_SENT_NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/**
 * Gửi email qua Microsoft Graph `sendMail` bằng client credentials (quyền APPLICATION `Mail.Send`) —
 * không có người dùng đăng nhập nên KHÔNG cần redirect URI.
 *
 * Phân loại kết quả theo câu hỏi "Microsoft đã nhận thư chưa?" (ADR-0016 D3, ADR-0018):
 *   202                                   -> accepted
 *   429, 503                              -> retryable (tôn trọng Retry-After) — chắc chắn chưa nhận
 *   401                                   -> retryable sau khi bỏ token cache (token hết hạn / bị thu hồi)
 *   4xx khác                              -> rejected (vĩnh viễn: địa chỉ sai, mailbox không có quyền...)
 *   5xx khác (500, 502, 504)              -> unknown — có thể Microsoft đã nhận rồi mới lỗi; không gửi lại
 *   không kết nối được (ECONNREFUSED...)  -> retryable — request chưa từng đi
 *   timeout / đứt kết nối giữa chừng       -> unknown
 *
 * Chỉ có HTML: body của `sendMail` dạng JSON mang MỘT nội dung; phần text thuần (`text`) để dành khi
 * chuyển sang gửi MIME.
 */
export class GraphEmailProvider implements EmailProvider {
  readonly name = 'graph';
  private readonly config: GraphConfig;
  private readonly fetch: Fetch;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private token: { value: string; expiresAt: number } | null = null;
  /** Nhiều lần gửi cùng lúc khi token hết hạn chỉ tạo MỘT request lấy token. */
  private tokenInFlight: Promise<string> | null = null;

  constructor(deps: { config: GraphConfig; clock: Clock; logger: Logger; fetch?: Fetch | undefined }) {
    this.config = deps.config;
    this.clock = deps.clock;
    this.logger = deps.logger.child('graph-email');
    this.fetch = deps.fetch ?? fetch;
  }

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    let token: string;
    try {
      token = await this.accessToken();
    } catch (err) {
      // Chưa lấy được token = thư chắc chắn chưa đi.
      return err instanceof TokenRejectedError
        ? { kind: 'rejected', reason: err.message }
        : { kind: 'retryable', reason: `token_unavailable: ${describe(err)}`, retryAfterMs: null };
    }

    let response: Response;
    try {
      response = await this.request(`${GRAPH}/users/${encodeURIComponent(this.config.sender)}/sendMail`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          // Microsoft trả lại header này — dùng khi cần nhờ Microsoft tra một lần gửi.
          'client-request-id': email.notificationId,
        },
        body: JSON.stringify(sendMailBody(email)),
      });
    } catch (err) {
      return networkFailure(err);
    }

    if (response.status === 202) {
      return { kind: 'accepted', providerMessageId: response.headers.get('request-id') };
    }
    const reason = `HTTP ${response.status} ${await graphError(response)}`;
    if (response.status === 429 || response.status === 503) {
      return { kind: 'retryable', reason, retryAfterMs: retryAfter(response) };
    }
    if (response.status === 401) {
      this.token = null;
      return { kind: 'retryable', reason, retryAfterMs: 0 };
    }
    if (response.status >= 400 && response.status < 500) return { kind: 'rejected', reason };
    return { kind: 'unknown', reason };
  }

  private async accessToken(): Promise<string> {
    const now = this.clock.now().getTime();
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) return this.token.value;
    this.tokenInFlight ??= this.fetchToken().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  private async fetchToken(): Promise<string> {
    const { tenantId, clientId, clientSecret } = this.config;
    const response = await this.request(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      },
    );
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof body['access_token'] !== 'string') {
      const detail = `${String(body['error'] ?? response.status)}: ${String(body['error_description'] ?? '').split('\r\n')[0]}`;
      // 400/401 từ Entra ID = cấu hình sai (secret sai / hết hạn, tenant sai...) — thử lại không khỏi.
      if (response.status === 400 || response.status === 401) throw new TokenRejectedError(`token_rejected: ${detail}`);
      throw new Error(`token endpoint ${detail}`);
    }
    const expiresIn = Number(body['expires_in'] ?? 3600);
    this.token = { value: body['access_token'], expiresAt: this.clock.now().getTime() + expiresIn * 1000 };
    this.logger.debug('graph token acquired', { expires_in_s: expiresIn });
    return this.token.value;
  }

  /** Mọi request đều có timeout — không để một kết nối treo giữ worker mãi. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    return this.fetch(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs) });
  }
}

class TokenRejectedError extends Error {}

/** Body `sendMail` (Graph v1.0). Không lưu Sent Items: mailbox noreply không cần phình ra. */
export function sendMailBody(email: OutgoingEmail) {
  return {
    message: {
      subject: email.subject,
      body: { contentType: 'HTML', content: email.html },
      toRecipients: [{ emailAddress: { address: email.to } }],
      // Header tuỳ biến phải bắt đầu bằng `X-` — truy vết thư (kể cả thư báo lỗi NDR) về notification.
      internetMessageHeaders: [{ name: 'X-EWS-Notification-Id', value: email.notificationId }],
    },
    saveToSentItems: false,
  };
}

function networkFailure(err: unknown): EmailSendResult {
  const code = errorCode(err);
  if (code && NOT_SENT_NETWORK_CODES.has(code)) {
    return { kind: 'retryable', reason: `network_not_sent: ${code}`, retryAfterMs: null };
  }
  // Timeout / đứt kết nối sau khi request có thể đã tới Microsoft -> không biết -> không gửi lại.
  return { kind: 'unknown', reason: `network: ${describe(err)}` };
}

/** Undici bọc lỗi hệ thống trong `cause`; AbortSignal.timeout ném TimeoutError. */
function errorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') return current.code;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return null;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'timeout' : err.message;
  return String(err);
}

function retryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  // Chỉ nhận dạng số giây (Graph dùng dạng này); thiếu hoặc dạng ngày HTTP -> để SendEmail tự lùi.
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** `{ error: { code, message } }` của Graph — cắt ngắn, đủ để biết vì sao bị từ chối. */
async function graphError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  const error = body?.error;
  return error ? `${error.code ?? ''}: ${error.message ?? ''}`.slice(0, 300) : '';
}
