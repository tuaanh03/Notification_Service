import { z } from 'zod';
import type { HttpRoutes } from '../../../../shared/http/index.ts';
import { NotFoundError } from '../../../../shared/kernel/index.ts';
import type { ReceiveIncomingCall } from '../../application/index.ts';

const TOKEN = /^ewshk_[A-Za-z0-9_-]{43}$/;
const params = z.object({ token: z.string() });

/**
 * `POST /hooks/:token` — bề mặt CÔNG KHAI, không API key: token trong URL chính là khoá (ADR-0030).
 * Body là JSON của công cụ ngoài (≤ 64 KB, giới hạn mặc định). 202 = đã phát · 200 = trùng / bỏ qua.
 * Token sai dạng trả 404 ngay, không chạm DB.
 */
export function publicHooksRoutes(useCases: { receive: ReceiveIncomingCall }): HttpRoutes {
  return (app) => {
    app.post('/hooks/:token', async (request, reply) => {
      const { token } = params.parse(request.params);
      if (!TOKEN.test(token)) throw new NotFoundError('incoming webhook', 'for this token');
      const header = request.headers['idempotency-key'];
      const origin = request.headers.origin;
      const result = await useCases.receive.execute({
        token,
        body: request.body ?? null,
        idempotencyKey: typeof header === 'string' ? header.slice(0, 255) : null,
        ip: request.ip,
        origin: typeof origin === 'string' ? origin : null,
      });
      return reply.status(result.status === 'published' ? 202 : 200).send(result);
    });
  };
}
