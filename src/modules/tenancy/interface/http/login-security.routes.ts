import { isIP } from 'node:net';
import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminContext, doc, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
import type { ListLoginLocks, UnlockLogin } from '../../application/index.ts';

const unlockBody = z.union([
  z.object({ email: z.string().trim().min(1).max(320) }).strict(),
  z.object({ ip: z.string().trim().refine((v) => isIP(v) !== 0, 'must be an IP address') }).strict(),
]);

/** `/admin/login-locks` — màn "Theo dõi & Bảo mật" (ADR-0039), chỉ Super Admin. Con số cài đặt đi qua `/system-settings`. */
export function loginSecurityRoutes(useCases: { listLoginLocks: ListLoginLocks; unlockLogin: UnlockLogin }): HttpRoutes {
  return (app) => {
    const tag = 'security';

    app.get(
      '/login-locks',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: list the sign-in lockouts currently held.',
            description:
              '`email` / `ip` locks are temporary and lift themselves at `until`; `account` locks are permanent and only a Super Admin can lift them.',
            responseDto: '{ locks: LoginLockDto[] }',
          }),
        },
      },
      async (_request, reply) => reply.header('cache-control', 'no-store').send({ locks: await useCases.listLoginLocks.execute() }),
    );

    app.post(
      '/login-locks/unlock',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: lift a sign-in lockout by email or by IP.',
            description:
              'By email: clears the temporary lock, the failure counter and a permanent account lock. By IP: clears the temporary lock of that IP. Nothing to unlock (already lifted or expired) -> 404.',
            body: unlockBody,
            example: { email: 'an.nguyen@company.com' },
            responseDto: '{ unlocked: true }',
            errors: [{ status: 404, code: 'NOT_FOUND' }],
          }),
        },
      },
      async (request) => {
        const body = parseInput(unlockBody, request.body);
        const ctx: CommandContext = adminContext(request);
        return useCases.unlockLogin.execute('email' in body ? { kind: 'email', email: body.email } : { kind: 'ip', ip: body.ip.toLowerCase() }, ctx);
      },
    );
  };
}
