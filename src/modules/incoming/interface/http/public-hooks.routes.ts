import { z } from 'zod';
import { doc, type HttpRoutes } from '../../../../shared/http/index.ts';
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
    app.post(
      '/hooks/:token',
      {
        config: doc({
          tag: 'hooks',
          summary: 'Receive a call from an external tool and publish to the hook topic. The token in the URL is the credential.',
          description:
            'Body: any JSON object (the tool\'s own payload, max 64 KB). Variables are read by the hook mappings, then same-name top-level fields. ' +
            '202 `{ status: "published", publicationId, recipientCount }` · 200 `{ status: "duplicate", … }` (same Idempotency-Key header or same body within the dedupe window) · ' +
            '200 `{ status: "skipped", reason: "condition_not_met" }`.',
          params,
          body: z.record(z.string(), z.unknown()),
          example: { incident_title: 'High CPU', severity: 'critical', alert_status: 'Triggered' },
          status: 202,
          responseDto: 'IncomingCallResult',
          errors: [
            { status: 404, code: 'NOT_FOUND' },
            { status: 403, code: 'APP_NOT_ACTIVE' },
            { status: 403, code: 'IP_NOT_ALLOWED' },
            { status: 422, code: 'INCOMING_BODY_INVALID' },
            { status: 422, code: 'MISSING_VARIABLE' },
            { status: 422, code: 'INVALID_PAYLOAD_VALUE' },
            { status: 422, code: 'TEMPLATE_NOT_PUBLISHED' },
            { status: 422, code: 'TOPIC_NOT_ACTIVE' },
            { status: 422, code: 'PUBLICATION_TOO_LARGE' },
            { status: 429, code: 'INCOMING_HOOK_RATE_LIMITED' },
          ],
        }),
      },
      async (request, reply) => {
        const { token } = params.parse(request.params);
        if (!TOKEN.test(token)) throw new NotFoundError('incoming webhook', 'for this token');
        const header = request.headers['idempotency-key'];
        const result = await useCases.receive.execute({
          token,
          body: request.body ?? null,
          idempotencyKey: typeof header === 'string' ? header.slice(0, 255) : null,
          ip: request.ip,
        });
        return reply.status(result.status === 'published' ? 202 : 200).send(result);
      },
    );
  };
}
