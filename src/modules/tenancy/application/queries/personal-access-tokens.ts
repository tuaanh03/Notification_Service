import { AuthenticationError, type AdminId, type AdminRole, type Clock, type PatScope, type PersonalAccessTokenId } from '../../../../shared/kernel/index.ts';
import { toAdminDto, toPersonalAccessTokenDto, type AdminDto, type AdminPersonalAccessTokenDto, type PersonalAccessTokenDto } from '../dto.ts';
import type { AdminRepository, PersonalAccessTokenFactory, PersonalAccessTokenRepository } from '../ports/index.ts';

/** Token đã thu hồi / hết hạn vẫn hiện trong danh sách chừng này ngày — để người dùng thấy "vì sao script hỏng". */
const SHOW_DEAD_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** Màn của Super Admin — một trang là đủ cho cỡ công ty này; quá thì hiện mới nhất. */
const ADMIN_LIST_LIMIT = 500;

/** Admin đứng sau một PAT còn hiệu lực — map thẳng sang `AdminCaller` (`via: 'pat'`). */
export interface AuthenticatedPatAdmin {
  adminId: AdminId;
  role: AdminRole;
  admin: AdminDto;
  tokenId: PersonalAccessTokenId;
  scope: PatScope;
}

/**
 * Xác thực `/admin/*` bằng PAT (ADR-0044). Mọi lý do hỏng (token lạ, hết hạn, thu hồi, admin bị khoá hẳn) trả CÙNG
 * 401 với phiên hỏng — không giúp người dò phân biệt. Ghi "dùng lần cuối" tối đa một lần mỗi phút, ngoài transaction.
 */
export class AuthenticatePersonalAccessToken {
  private readonly deps: { clock: Clock; admins: AdminRepository; tokens: PersonalAccessTokenRepository; factory: PersonalAccessTokenFactory };

  constructor(deps: AuthenticatePersonalAccessToken['deps']) {
    this.deps = deps;
  }

  /** Chuỗi này có phải PAT không — xác thực `/admin` rẽ nhánh theo tiền tố. */
  matches(token: string | null): boolean {
    return token !== null && token.startsWith(this.deps.factory.prefix);
  }

  async execute(input: { token: string; ip: string | null }): Promise<AuthenticatedPatAdmin> {
    const { clock, admins, tokens, factory } = this.deps;
    const token = await tokens.findByTokenHash(factory.hashOf(input.token));
    const now = clock.now();
    if (token === null || !token.isUsableAt(now)) throw invalid();
    const admin = await admins.findById(token.adminId);
    if (admin === null || admin.isLocked) throw invalid();
    if (token.recordUse(now, input.ip)) await tokens.updateLastUsed(token);
    return { adminId: admin.id, role: admin.role, admin: toAdminDto(admin), tokenId: token.id, scope: token.scope };
  }
}

/** PAT của chính mình, mới nhất trước — gồm token chết trong 30 ngày qua. */
export class ListPersonalAccessTokens {
  private readonly deps: { clock: Clock; tokens: PersonalAccessTokenRepository };

  constructor(deps: ListPersonalAccessTokens['deps']) {
    this.deps = deps;
  }

  async execute(adminId: AdminId): Promise<{ tokens: PersonalAccessTokenDto[] }> {
    const now = this.deps.clock.now();
    const rows = await this.deps.tokens.listByAdmin(adminId, new Date(now.getTime() - SHOW_DEAD_FOR_MS));
    return { tokens: rows.map((t) => toPersonalAccessTokenDto(t, now)) };
  }
}

/** Super Admin: PAT của mọi người kèm người sở hữu (lấy theo LÔ). `active` = chỉ token còn hiệu lực. */
export class ListAllPersonalAccessTokens {
  private readonly deps: { clock: Clock; admins: AdminRepository; tokens: PersonalAccessTokenRepository };

  constructor(deps: ListAllPersonalAccessTokens['deps']) {
    this.deps = deps;
  }

  async execute(input: { status: 'active' | 'all' }): Promise<{ tokens: AdminPersonalAccessTokenDto[] }> {
    const now = this.deps.clock.now();
    const rows = await this.deps.tokens.listAll({
      activeAt: input.status === 'active' ? now : undefined,
      since: new Date(now.getTime() - SHOW_DEAD_FOR_MS),
      limit: ADMIN_LIST_LIMIT,
    });
    const owners = new Map((await this.deps.admins.findManyByIds([...new Set(rows.map((t) => t.adminId))])).map((a) => [a.id as string, a]));
    return {
      tokens: rows.map((t) => {
        const owner = owners.get(t.adminId);
        return { ...toPersonalAccessTokenDto(t, now), adminId: t.adminId, adminEmail: owner?.email ?? '', adminName: owner?.displayName ?? null };
      }),
    };
  }
}

function invalid(): AuthenticationError {
  return new AuthenticationError('INVALID_ADMIN_SESSION', 'admin session is missing, expired or invalid');
}
