import type { AdminAuthenticator, AdminCaller } from '../../../../shared/http/index.ts';
import type { AuthenticateAdminSession, AuthenticatePersonalAccessToken } from '../../application/queries/index.ts';

/**
 * Nối hai use case xác thực vào hợp đồng `/admin/*` của shared/http: token mang tiền tố PAT (`ewspat_`) đi đường
 * personal access token (ADR-0044), còn lại là phiên đăng nhập (ADR-0019). Thay `BootstrapAdminAuthenticator` —
 * ADR-0015 §4 đã hẹn sẵn: "chỉ cần hiện thực `AdminAuthenticator` mới, route không đổi".
 *
 * Nhờ lớp này, route `/admin/*` của MỌI module được bảo vệ mà không module nào phải import tenancy.
 */
export class SessionAdminAuthenticator implements AdminAuthenticator {
  private readonly authenticateAdminSession: AuthenticateAdminSession;
  private readonly authenticatePersonalAccessToken: AuthenticatePersonalAccessToken;

  constructor(deps: { authenticateAdminSession: AuthenticateAdminSession; authenticatePersonalAccessToken: AuthenticatePersonalAccessToken }) {
    this.authenticateAdminSession = deps.authenticateAdminSession;
    this.authenticatePersonalAccessToken = deps.authenticatePersonalAccessToken;
  }

  async authenticate(input: { bearerToken: string | null; ip: string | null }): Promise<AdminCaller> {
    if (input.bearerToken !== null && this.authenticatePersonalAccessToken.matches(input.bearerToken)) {
      const pat = await this.authenticatePersonalAccessToken.execute({ token: input.bearerToken, ip: input.ip });
      return { kind: 'admin', adminId: pat.adminId, role: pat.role, via: 'pat', tokenId: pat.tokenId, scope: pat.scope };
    }
    const { adminId, role } = await this.authenticateAdminSession.execute({ token: input.bearerToken });
    return { kind: 'admin', adminId, role, via: 'session', tokenId: null, scope: null };
  }
}
