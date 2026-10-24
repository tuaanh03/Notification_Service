import { access, adminAccess, adminCaller, doc, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AdminId } from '../../../../shared/kernel/index.ts';
import type { GetAdminProfile } from '../../application/index.ts';

/** `GET /admin/me` — vai của chính người gọi, ai đăng nhập cũng xem được (ADR-0022). */
export function adminMeRoutes(useCases: { getAdminProfile: GetAdminProfile }): HttpRoutes {
  return (app) => {
    app.get(
      '/me',
      {
        config: {
          ...access('self.read'),
          ...doc({
            tag: 'me',
            summary: 'Get who you are: Super Admin flag, organizations and app roles, plus how this request was authenticated.',
            description: '`auth.via` is `session` or `pat`; with a personal access token, `auth.tokenId` and `auth.scope` identify the token, so a script can check its own token here.',
            responseDto: "AdminProfileDto & { auth: { via: 'session' | 'pat'; tokenId: string | null; scope: 'read' | 'write' | null } }",
          }),
        },
      },
      async (request, reply) => {
        const caller = adminCaller(request);
        const profile = await useCases.getAdminProfile.execute({ adminId: AdminId.parse(caller.adminId), access: adminAccess(request) });
        // Cách đang xác thực (ADR-0044) — script dùng PAT tự kiểm token của mình bằng route này.
        const auth = { via: caller.via, tokenId: caller.tokenId, scope: caller.scope };
        return reply.header('cache-control', 'no-store').send({ ...profile, auth });
      },
    );
  };
}
