import { audited, type CommandContext } from '../../../../shared/application/index.ts';
import { isEmail, normalizeEmail, PermissionDeniedError } from '../../../../shared/kernel/index.ts';
import type { Admin } from '../../domain/entities/admin.ts';
import type { SignInDto } from '../dto.ts';
import type { AdminRepository, MicrosoftIdentity } from '../ports/index.ts';
import { issueAdminSession, type IssueSessionDeps } from './issue-admin-session.ts';
import { m365NotConfigured } from './start-microsoft-login.ts';

/**
 * Đăng nhập bằng Microsoft 365 (ADR-0021). Chỉ admin ĐÃ CÓ trong hệ thống mới vào được — chưa có
 * RBAC thì tự tạo tài khoản ở đây là mở toàn bộ console cho mọi người trong công ty.
 *
 * 1. Tra theo `oid` (đã gắn từ lần trước) — email đổi trên M365 vẫn vào đúng tài khoản.
 * 2. Chưa gắn: khớp email đã chuẩn hoá -> gắn `oid` vào admin đó (chỉ khi admin chưa gắn ai khác).
 * 3. Không khớp: 403 `M365_ACCOUNT_NOT_REGISTERED`. Người này đã được Microsoft xác thực, nên nói rõ
 *    lý do không lộ gì thêm — khác với đăng nhập mật khẩu (một mã chung cho mọi lỗi).
 *
 * Không đòi mật khẩu: admin chỉ dùng M365 không cần có `password_hash`.
 */
export class LoginAdminWithMicrosoft {
  private readonly deps: IssueSessionDeps & { identity: MicrosoftIdentity; admins: AdminRepository };

  constructor(deps: LoginAdminWithMicrosoft['deps']) {
    this.deps = deps;
  }

  async execute(input: { code: string; state: string }, ctx: CommandContext): Promise<SignInDto> {
    const { identity, admins, uow, outbox, clock } = this.deps;
    if (!identity.configured) throw m365NotConfigured();

    const profile = await identity.complete(input);
    let admin = await admins.findByMicrosoftOid(profile.oid);

    if (admin === null) {
      // Claim email lạ dạng (không có `@`…) coi như không có email — không ném lỗi chuẩn hoá ra ngoài.
      const email = profile.email !== null && isEmail(profile.email) ? normalizeEmail(profile.email) : null;
      const candidate = email === null ? null : await admins.findByEmail(email);
      if (candidate === null) {
        throw new PermissionDeniedError('M365_ACCOUNT_NOT_REGISTERED', 'this Microsoft account has no EWS admin account');
      }
      // Ném M365_ACCOUNT_MISMATCH nếu admin đã gắn một tài khoản Microsoft KHÁC.
      candidate.linkMicrosoft(profile.oid, clock.now());
      admin = await uow.run(async () => {
        if (!(await admins.linkMicrosoft(candidate))) return relinked(admins, candidate, profile.oid);
        await outbox.append([
          {
            aggregateType: 'Admin',
            aggregateId: candidate.id,
            eventType: 'AdminMicrosoftLinked',
            payload: audited({ ...ctx, actor: { id: candidate.id, type: 'admin' } }, { after: { microsoftOid: profile.oid } }),
          },
        ]);
        return candidate;
      });
    }

    return issueAdminSession(this.deps, admin, 'microsoft', { ...ctx, actor: { id: admin.id, type: 'admin' } });
  }
}

/** Lần đăng nhập đầu chạy song song: lần kia gắn trước. Cùng `oid` thì vào tiếp, khác thì từ chối. */
async function relinked(admins: AdminRepository, admin: Admin, oid: string): Promise<Admin> {
  const current = await admins.findById(admin.id);
  if (current?.microsoftOid !== oid) {
    throw new PermissionDeniedError('M365_ACCOUNT_MISMATCH', 'admin is linked to a different Microsoft account');
  }
  return current;
}
