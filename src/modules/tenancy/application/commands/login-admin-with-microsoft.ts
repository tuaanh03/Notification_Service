import { audited, type CommandContext } from '../../../../shared/application/index.ts';
import { AdminId, isEmail, normalizeEmail, PermissionDeniedError, type NormalizedEmail } from '../../../../shared/kernel/index.ts';
import { Admin } from '../../domain/entities/admin.ts';
import type { SignInDto } from '../dto.ts';
import type { AccountRepository, AdminRepository, MicrosoftIdentity } from '../ports/index.ts';
import { issueAdminSession, type IssueSessionDeps } from './issue-admin-session.ts';
import { m365NotConfigured } from './start-microsoft-login.ts';

/**
 * Đăng nhập bằng Microsoft 365 (ADR-0021, ADR-0024).
 *
 * 1. Tra theo `oid` (đã gắn từ lần trước) — email đổi trên M365 vẫn vào đúng tài khoản.
 * 2. Chưa gắn: khớp email đã chuẩn hoá -> gắn `oid` vào admin đó (chỉ khi admin chưa gắn ai khác).
 * 3. Không khớp: TỰ TẠO tài khoản (ADR-0024) — vai `user`, chưa thuộc org nào, chưa có mật khẩu,
 *    vào account của bản cài (account tạo đầu tiên). Có RBAC rồi nên vào được cũng chưa thấy gì:
 *    quyền chỉ đến khi tự tạo org hoặc được Owner thêm vào. Chỉ người trong tenant M365 của công
 *    ty qua được bước kiểm token (`tid`), nên đây không phải đăng ký công khai.
 *    Token không có email hợp lệ -> 403 `M365_ACCOUNT_NOT_REGISTERED` (không có gì để định danh).
 *
 * Không đòi mật khẩu: admin chỉ dùng M365 không cần có `password_hash`.
 */
export class LoginAdminWithMicrosoft {
  private readonly deps: IssueSessionDeps & {
    identity: MicrosoftIdentity;
    admins: AdminRepository;
    accounts: AccountRepository;
  };

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
      if (email === null) {
        throw new PermissionDeniedError('M365_ACCOUNT_NOT_REGISTERED', 'this Microsoft account has no usable email');
      }
      const candidate = await admins.findByEmail(email);
      if (candidate === null) {
        const created = await this.register(email, profile.oid, ctx);
        return issueAdminSession(this.deps, created, 'microsoft', { ...ctx, actor: { id: created.id, type: 'admin' } });
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

  /**
   * Tạo tài khoản ở lần đăng nhập đầu (ADR-0024). Hai lần đầu chạy song song: lần thua dính trùng
   * khoá (`uq_admins_microsoft_oid` / email) -> đọc lại theo `oid`. Không thấy nghĩa là email đã
   * thuộc một danh tính Microsoft khác -> từ chối, như nhánh gắn `oid`.
   */
  private async register(email: NormalizedEmail, oid: string, ctx: CommandContext): Promise<Admin> {
    const { admins, accounts, uow, outbox, clock } = this.deps;
    const account = await accounts.findOldest();
    if (account === null) {
      throw new PermissionDeniedError('M365_ACCOUNT_NOT_REGISTERED', 'EWS has no account to register into yet');
    }
    const admin = new Admin({
      id: AdminId.create(),
      accountId: account.id,
      email,
      role: 'user',
      passwordHash: null,
      microsoftOid: oid,
      createdAt: clock.now(),
    });
    const inserted = await uow.run(async () => {
      if (!(await admins.insertIfAbsent(admin))) return false;
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: admin.id,
          eventType: 'AdminCreated',
          payload: audited(
            { ...ctx, actor: { id: admin.id, type: 'admin' } },
            { after: { email: admin.email, role: admin.role, hasPassword: false, microsoftOid: oid, via: 'microsoft_first_sign_in' } },
          ),
        },
      ]);
      return true;
    });
    if (inserted) return admin;
    const winner = await admins.findByMicrosoftOid(oid);
    if (winner === null) {
      throw new PermissionDeniedError('M365_ACCOUNT_MISMATCH', 'email belongs to an admin linked to a different Microsoft account');
    }
    return winner;
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
