import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  AdminId,
  ConflictError,
  NotFoundError,
  normalizeEmail,
  type AccountId,
  type AdminRole,
  type Clock,
} from '../../../../shared/kernel/index.ts';
import { Admin } from '../../domain/entities/admin.ts';
import { assertPasswordAllowed } from '../../domain/rules/password-policy.ts';
import { toAdminDto, type AdminDto } from '../dto.ts';
import type { AccountRepository, AdminRepository, PasswordHasher } from '../ports/index.ts';

/**
 * Tạo admin. CỐ Ý KHÔNG có route HTTP — chỉ gọi được bằng CLI chạy trong container
 * (`src/entrypoints/admin-cli`), vì admin đầu tiên phải tạo được khi chưa ai đăng nhập được.
 *
 * Cho việc này đi qua HTTP thì lại phải có một token toàn quyền nằm trong env — đúng thứ vừa bỏ
 * đi. Ai chạy được CLI là người đã có quyền trên máy chủ: không mở thêm bề mặt tấn công nào.
 */
export class CreateAdmin {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    accounts: AccountRepository;
    admins: AdminRepository;
    passwords: PasswordHasher;
  };

  constructor(deps: CreateAdmin['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { accountId: AccountId; email: string; password: string; role: AdminRole },
    ctx: CommandContext,
  ): Promise<AdminDto> {
    const { uow, outbox, clock, accounts, admins, passwords } = this.deps;
    assertPasswordAllowed(input.password);

    const email = normalizeEmail(input.email);
    if ((await accounts.findById(input.accountId)) === null) throw new NotFoundError('Account', input.accountId);
    // Kiểm trước để báo lỗi rõ ràng; `uq_admins_account_email` vẫn là chốt cuối (ADR-0009).
    if ((await admins.findByEmail(email)) !== null) {
      throw new ConflictError('ADMIN_EMAIL_TAKEN', `admin ${email} already exists`);
    }

    const admin = new Admin({
      id: AdminId.create(),
      accountId: input.accountId,
      email,
      role: input.role,
      passwordHash: await passwords.hash(input.password),
      createdAt: clock.now(),
    });

    return uow.run(async () => {
      await admins.insert(admin);
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: admin.id,
          eventType: 'AdminCreated',
          payload: audited(ctx, { after: { email: admin.email, role: admin.role } }),
        },
      ]);
      return toAdminDto(admin);
    });
  }
}
