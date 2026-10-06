import type { CommandContext, EventOutbox, UnitOfWork } from '../../../../shared/application/index.ts';
import { AuthenticationError, normalizeEmail, type Clock } from '../../../../shared/kernel/index.ts';
import type { SignInDto } from '../dto.ts';
import type { AdminRepository, AdminSessionRepository, PasswordHasher, SessionTokenFactory } from '../ports/index.ts';
import { issueAdminSession } from './issue-admin-session.ts';

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

    return issueAdminSession({ uow, outbox, clock, sessions, tokens, sessionTtlMs }, admin, 'password', ctx);
  }
}
