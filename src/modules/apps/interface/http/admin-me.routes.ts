import { access, adminAccess, adminCaller, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AdminId } from '../../../../shared/kernel/index.ts';
import type { GetAdminProfile } from '../../application/index.ts';

/** `GET /admin/me` — vai của chính người gọi, ai đăng nhập cũng xem được (ADR-0022). */
export function adminMeRoutes(useCases: { getAdminProfile: GetAdminProfile }): HttpRoutes {
  return (app) => {
    app.get('/me', { config: access('self.read') }, async (request, reply) => {
      const profile = await useCases.getAdminProfile.execute({
        adminId: AdminId.parse(adminCaller(request).adminId),
        access: adminAccess(request),
      });
      return reply.header('cache-control', 'no-store').send(profile);
    });
  };
}
