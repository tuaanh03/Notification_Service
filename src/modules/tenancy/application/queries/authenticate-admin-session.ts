import { AuthenticationError, type AdminId, type AdminRole, type Clock } from '../../../../shared/kernel/index.ts';
import { toAdminDto, type AdminDto } from '../dto.ts';
import type { AdminRepository, AdminSessionRepository, SessionTokenFactory } from '../ports/index.ts';

/** Admin đứng sau một phiên còn hiệu lực. `adminId` + `role` map thẳng sang `AdminCaller`. */
export interface AuthenticatedAdmin {
  adminId: AdminId;
  role: AdminRole;
  /** Hồ sơ để console hiện "đang đăng nhập là ai" — cùng một lần đọc, không thêm truy vấn. */
  admin: AdminDto;
}

/**
 * Chạy ở MỌI request `/admin/*`, nên chỉ đọc hai dòng theo khoá: phiên rồi admin.
 *
 * Mọi lý do hỏng (thiếu token, token lạ, hết hạn, admin đã bị xoá) đều trả CÙNG một mã 401.
 * Console chỉ cần biết "đăng nhập lại đi"; nói rõ hơn là giúp người dò đoán token.
 */
export class AuthenticateAdminSession {
  private readonly deps: { clock: Clock; admins: AdminRepository; sessions: AdminSessionRepository; tokens: SessionTokenFactory };

  constructor(deps: AuthenticateAdminSession['deps']) {
    this.deps = deps;
  }

  async execute(input: { token: string | null }): Promise<AuthenticatedAdmin> {
    const { clock, admins, sessions, tokens } = this.deps;
    if (input.token === null || input.token === '') throw invalid();

    const session = await sessions.findByTokenHash(tokens.hashOf(input.token));
    if (session === null) throw invalid();
    if (session.isExpired(clock.now())) {
      // Dọn ngay dòng vừa đụng tới: bảng tự sạch dần, không cần job định kỳ.
      await sessions.deleteById(session.id);
      throw invalid();
    }

    const admin = await admins.findById(session.adminId);
    if (admin === null) throw invalid();
    return { adminId: admin.id, role: admin.role, admin: toAdminDto(admin) };
  }
}

function invalid(): AuthenticationError {
  return new AuthenticationError('INVALID_ADMIN_SESSION', 'admin session is missing, expired or invalid');
}
