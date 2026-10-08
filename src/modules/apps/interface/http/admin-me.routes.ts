import { access, adminAccess, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { GetAdminProfile } from '../../application/index.ts';

/** `GET /admin/me` — vai của chính người gọi, ai đăng nhập cũng xem được (ADR-0022). */
export function adminMeRoutes(useCases: { getAdminProfile: GetAdminProfile }): HttpRoutes {
  return (app) => {
    app.get('/me', { config: access('self.read') }, async (request, reply) =>
      reply.header('cache-control', 'no-store').send(await useCases.getAdminProfile.execute(adminAccess(request))),
    );
  };
}
