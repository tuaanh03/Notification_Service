import type { AdminAuthenticator, AdminCaller } from '../../../../shared/http/index.ts';
import type { AuthenticateAdminSession } from '../../application/queries/index.ts';

/**
 * Nối use case `AuthenticateAdminSession` vào hợp đồng xác thực `/admin/*` của shared/http.
 * Thay `BootstrapAdminAuthenticator` — ADR-0015 §4 đã hẹn sẵn: "chỉ cần hiện thực
 * `AdminAuthenticator` mới, route không đổi".
 *
 * Nhờ lớp này, route `/admin/*` của MỌI module được bảo vệ bằng phiên đăng nhập thật mà không
 * module nào phải import tenancy.
 */
export class SessionAdminAuthenticator implements AdminAuthenticator {
  private readonly authenticateAdminSession: AuthenticateAdminSession;

  constructor(deps: { authenticateAdminSession: AuthenticateAdminSession }) {
    this.authenticateAdminSession = deps.authenticateAdminSession;
  }

  async authenticate(input: { bearerToken: string | null }): Promise<AdminCaller> {
    const { adminId, role } = await this.authenticateAdminSession.execute({ token: input.bearerToken });
    return { kind: 'admin', adminId, role };
  }
}
