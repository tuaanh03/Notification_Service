import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { PublicationId, TemplateId } from '../../../../shared/kernel/index.ts';
import type { GetPublication, PublishToTopic } from '../../application/index.ts';

// Như `POST /v1/notifications` nhưng không có `to` — người nhận là người đang theo dõi topic.
// `idempotencyKey` khai optional ở đây để thiếu thì command trả đúng mã IDEMPOTENCY_KEY_REQUIRED.
const publishBody = z
  .object({
    topic: z.string().min(1).max(128),
    subject: z.string().optional(),
    html: z.string().optional(),
    text: z.string().optional(),
    templateId: z.string().uuid().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();
const idParams = z.object({ id: z.string().uuid() });

/**
 * `POST /v1/publications` — phát một tin cho mọi người đang theo dõi topic (ADR-0028). 202 = đã tạo các
 * thư con, CHƯA gửi; theo dõi bằng `GET /v1/publications/:id`. Trùng `idempotencyKey` -> 200 kèm lần phát cũ.
 */
export function v1PublicationsRoutes(useCases: { publish: PublishToTopic; get: GetPublication }): HttpRoutes {
  return (app) => {
    app.post('/publications', { bodyLimit: LARGE_BODY_LIMIT_BYTES }, async (request, reply) => {
      const caller = appCaller(request);
      const body = parseInput(publishBody, request.body);
      const ctx: CommandContext = { actor: { id: caller.appId, type: 'app' }, source: 'v1_api' };
      const { publication, created } = await useCases.publish.execute(
        {
          appId: caller.appId,
          grantedChannels: caller.grantedChannels,
          topic: body.topic,
          subject: body.subject,
          html: body.html,
          text: body.text,
          templateId: body.templateId === undefined ? undefined : TemplateId.parse(body.templateId),
          payload: body.payload,
          idempotencyKey: body.idempotencyKey,
        },
        ctx,
      );
      return reply
        .status(created ? 202 : 200)
        .header('location', `/v1/publications/${publication.id}`)
        .send(publication);
    });

    app.get('/publications/:id', async (request) => {
      const { id } = parseInput(idParams, request.params);
      return useCases.get.execute({ appId: appCaller(request).appId, id: PublicationId.parse(id) });
    });
  };
}
