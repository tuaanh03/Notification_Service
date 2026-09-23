import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, normalizeEmail, type Clock } from '../../../../shared/kernel/index.ts';
import { assertPasswordAllowed } from '../../domain/rules/password-policy.ts';
import { toAdminDto, type AdminDto } from '../dto.ts';
import type { AdminRepository, AdminSessionRepository, PasswordHasher } from '../ports/index.ts';

/**
 * Đặt lại mật khẩu — thay cho vai trò "khoá dự phòng" mà `ADMIN_TOKEN` từng gánh. Gọi bằng CLI.
 *
 * Đổi mật khẩu thì XOÁ MỌI PHIÊN đang mở của admin đó. Không làm vậy thì kẻ đã chiếm được phiên
 * vẫn ở nguyên trong hệ thống dù mật khẩu đã đổi — tức là đổi mật khẩu không cứu được gì.
 */
export class SetAdminPassword {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    admins: AdminRepository;
    sessions: AdminSessionRepository;
    passwords: PasswordHasher;
  };

  constructor(deps: SetAdminPassword['deps']) {
    this.deps = deps;
  }

  async execute(input: { email: string; password: string }, ctx: CommandContext): Promise<AdminDto> {
    const { uow, outbox, clock, admins, sessions, passwords } = this.deps;
    assertPasswordAllowed(input.password);

    const email = normalizeEmail(input.email);
    const admin = await admins.findByEmail(email);
    if (admin === null) throw new NotFoundError('Admin', email);

    admin.passwordHash = await passwords.hash(input.password);
    admin.markPasswordChanged(clock.now());

    return uow.run(async () => {
      await admins.updatePassword(admin);
      await sessions.deleteByAdmin(admin.id);
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: admin.id,
          eventType: 'AdminPasswordChanged',
          // KHÔNG ghi băm cũ lẫn mới vào audit — audit_log đọc được rộng hơn bảng admins.
          payload: audited(ctx, { after: { email: admin.email, sessionsRevoked: true } }),
        },
      ]);
      return toAdminDto(admin);
    });
  }
}
