import { isIP } from 'node:net';
import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { ListLoginLocks, UnlockLogin } from '../../application/index.ts';

const unlockBody = z.union([
  z.object({ email: z.string().trim().min(1).max(320) }).strict(),
  z.object({ ip: z.string().trim().refine((v) => isIP(v) !== 0, 'must be an IP address') }).strict(),
]);

/** `/admin/login-locks` — màn "Theo dõi & Bảo mật" (ADR-0039), chỉ Super Admin. Con số cài đặt đi qua `/system-settings`. */
export function loginSecurityRoutes(useCases: { listLoginLocks: ListLoginLocks; unlockLogin: UnlockLogin }): HttpRoutes {
  return (app) => {
    app.get('/login-locks', { config: access('platform.manage') }, async (_request, reply) =>
      reply.header('cache-control', 'no-store').send({ locks: await useCases.listLoginLocks.execute() }),
    );

    app.post('/login-locks/unlock', { config: access('platform.manage') }, async (request) => {
      const body = parseInput(unlockBody, request.body);
      const ctx: CommandContext = { actor: { id: adminCaller(request).adminId, type: 'admin' }, source: 'admin_api' };
      return useCases.unlockLogin.execute('email' in body ? { kind: 'email', email: body.email } : { kind: 'ip', ip: body.ip.toLowerCase() }, ctx);
    });
  };
}
