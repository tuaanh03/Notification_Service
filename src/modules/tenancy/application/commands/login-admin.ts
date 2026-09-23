import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { AdminSessionId, AuthenticationError, normalizeEmail, type Clock } from '../../../../shared/kernel/index.ts';
import { AdminSession } from '../../domain/entities/admin-session.ts';
import { toAdminDto, type SignInDto } from '../dto.ts';
import type { AdminRepository, AdminSessionRepository, PasswordHasher, SessionTokenFactory } from '../ports/index.ts';

/**
 * Mật khẩu giả để băm khi không tìm thấy admin. Thiếu nó thì email lạ trả lời NHANH hơn email
 * thật (bỏ qua bước băm chậm), và người ngoài dò ra được ai là admin chỉ bằng thời gian phản hồi.
 */
export const DUMMY_PASSWORD = 'not-a-real-password-placeholder';

export class LoginAdmin {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    admins: AdminRepository;
    sessions: AdminSessionRepository;
    passwords: PasswordHasher;
    tokens: SessionTokenFactory;
    /** Hạn TUYỆT ĐỐI của phiên. Hết hạn là đăng nhập lại, không gia hạn ngầm. */
    sessionTtlMs: number;
    /** Băm của `DUMMY_PASSWORD`, tính MỘT lần lúc khởi động. */
    dummyHash: Promise<string>;
  };

  constructor(deps: LoginAdmin['deps']) {
    this.deps = deps;
  }

  async execute(input: { email: string; password: string }, ctx: CommandContext): Promise<SignInDto> {
    const { uow, outbox, clock, admins, sessions, passwords, tokens, sessionTtlMs, dummyHash } = this.deps;

    const admin = await admins.findByEmail(normalizeEmail(input.email));
    // Sai email, sai mật khẩu, hay chưa đặt mật khẩu đều trả CÙNG một lỗi: không xác nhận hộ
    // người dò rằng email nào có thật.
    const ok = await passwords.verify(input.password, admin?.passwordHash ?? (await dummyHash));
    if (admin === null || !admin.canSignIn || !ok) {
      throw new AuthenticationError('INVALID_CREDENTIALS', 'email or password is incorrect');
    }

    const issued = tokens.create();
    const now = clock.now();
    const session = new AdminSession({
      id: AdminSessionId.create(),
      adminId: admin.id,
      tokenHash: issued.hash,
      expiresAt: new Date(now.getTime() + sessionTtlMs),
      createdAt: now,
    });

    return uow.run(async () => {
      await sessions.insert(session);
      await outbox.append([
        {
          aggregateType: 'Admin',
          aggregateId: admin.id,
          eventType: 'AdminSignedIn',
          // Chỉ id phiên, KHÔNG token: audit_log không được chứa thứ dùng để mạo danh.
          payload: audited(ctx, { after: { sessionId: session.id, expiresAt: session.expiresAt.toISOString() } }),
        },
      ]);
      return { token: issued.token, expiresAt: session.expiresAt.toISOString(), admin: toAdminDto(admin) };
    });
  }
}
