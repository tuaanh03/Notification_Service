import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { bearerToken, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { LoginAdmin, LogoutAdmin } from '../../application/commands/index.ts';
import type { AuthenticateAdminSession } from '../../application/queries/index.ts';

const loginBody = z
  .object({
    email: z.string().trim().min(1).max(320),
    // Cố ý KHÔNG dùng z.email(): email sai định dạng cũng phải trả 401 như email không tồn tại.
    // Trả 422 ở đây là xác nhận hộ người dò rằng định dạng kia "hợp lệ nhưng không có trong hệ thống".
    password: z.string().min(1).max(200),
  })
  .strict();

/**
 * `/auth/*` — bề mặt PUBLIC, không có hook xác thực. Đúng như vậy: đây là cửa để LẤY phiên,
 * nên không thể đòi phiên trước.
 *
 * Cố ý KHÔNG đặt dưới `/admin`: mọi thứ dưới `/admin` đều nằm sau hook xác thực (ADR-0015 §2),
 * một route ngoại lệ nằm lẫn trong đó là thứ người sau sẽ hiểu nhầm.
 *
 * Cookie do console (Next.js) đặt, không phải ở đây: backend chỉ nhận `Authorization: Bearer`
 * và không biết trình duyệt tồn tại.
 */
export function authRoutes(useCases: {
  loginAdmin: LoginAdmin;
  logoutAdmin: LogoutAdmin;
  authenticateAdminSession: AuthenticateAdminSession;
}): HttpRoutes {
  return (app) => {
    app.post('/auth/login', async (request, reply) => {
      const body = parseInput(loginBody, request.body);
      // Chưa biết là ai lúc bắt đầu -> actor tạm là chính địa chỉ email đang thử.
      const ctx: CommandContext = { actor: { id: body.email, type: 'admin' }, source: 'admin_api' };
      const result = await useCases.loginAdmin.execute(body, ctx);
      // Token chỉ sống trong response này -> no-store để không proxy nào giữ lại.
      return reply.header('cache-control', 'no-store').send(result);
    });

    app.post('/auth/logout', async (request, reply) => {
      const token = bearerToken(request);
      // Không có token = đã đăng xuất. Trả 204 luôn, để console gọi được cả khi phiên đã chết.
      if (token === null) return reply.status(204).send();
      // Lấy adminId cho audit; phiên hỏng thì vẫn đăng xuất bình thường, không chặn.
      const adminId = await useCases.authenticateAdminSession
        .execute({ token })
        .then((a) => a.adminId as string)
        .catch(() => null);
      const ctx: CommandContext = { actor: { id: adminId ?? 'unknown', type: 'admin' }, source: 'admin_api' };
      await useCases.logoutAdmin.execute({ token }, ctx);
      return reply.status(204).send();
    });

    app.get('/auth/me', async (request, reply) => {
      const authenticated = await useCases.authenticateAdminSession.execute({ token: bearerToken(request) });
      return reply.header('cache-control', 'no-store').send(authenticated.admin);
    });
  };
}
