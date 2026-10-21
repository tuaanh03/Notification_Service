import type { CommandContext, EventOutbox, UnitOfWork } from '../../../../shared/application/index.ts';
import { AuthenticationError, normalizeEmail, type Clock } from '../../../../shared/kernel/index.ts';
import type { SignInDto } from '../dto.ts';
import type { AdminRepository, AdminSessionRepository, PasswordHasher, SessionTokenFactory } from '../ports/index.ts';
import { loginSubject } from '../../domain/rules/login-throttle.ts';
import { issueAdminSession } from './issue-admin-session.ts';
import type { LoginThrottle } from './login-throttle.ts';

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
    /** Chặn sai nhiều lần (ADR-0039). */
    throttle: LoginThrottle;
  };

  constructor(deps: LoginAdmin['deps']) {
    this.deps = deps;
  }

  /**
   * `ip` = IP thật của trình duyệt do console chuyển sang (ADR-0039); `null` = không biết -> chỉ đếm theo email.
   *
   * Đang bị khoá tạm, tài khoản bị khoá hẳn, sai mật khẩu, email lạ — đều CÙNG một lỗi: không xác nhận hộ người dò
   * rằng email nào có thật, cũng không cho biết đang bị khoá (để họ không biết phải chờ bao lâu).
   */
  async execute(input: { email: string; password: string; ip?: string | null | undefined }, ctx: CommandContext): Promise<SignInDto> {
    const { uow, outbox, clock, admins, sessions, passwords, tokens, sessionTtlMs, dummyHash, throttle } = this.deps;
    const subject = loginSubject(input.email);
    const ip = input.ip ?? null;
    // Đang khoá thì không băm mật khẩu: đoán đúng trong lúc khoá cũng không vào được, khỏi tốn CPU cho người dò.
    if (await throttle.isBlocked(subject, ip)) throw invalidCredentials();

    const admin = await admins.findByEmail(normalizeEmail(input.email));
    // Sai email, sai mật khẩu, hay chưa đặt mật khẩu đều trả CÙNG một lỗi: không xác nhận hộ
    // người dò rằng email nào có thật.
    const ok = await passwords.verify(input.password, admin?.passwordHash ?? (await dummyHash));
    if (admin === null || !admin.canSignIn || !ok) {
      await throttle.recordFailure(subject, ip, admin, ctx);
      throw invalidCredentials();
    }
    // Khoá hẳn: chỉ Super Admin mở. Đúng mật khẩu thì không đếm thêm — đã khoá rồi.
    if (admin.isLocked) throw invalidCredentials();

    await throttle.clear(subject);
    return issueAdminSession({ uow, outbox, clock, sessions, tokens, sessionTtlMs }, admin, 'password', ctx);
  }
}

function invalidCredentials(): AuthenticationError {
  return new AuthenticationError('INVALID_CREDENTIALS', 'email or password is incorrect');
}
