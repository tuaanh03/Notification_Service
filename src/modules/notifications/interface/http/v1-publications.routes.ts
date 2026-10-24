import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, doc, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { PublicationId, TemplateId } from '../../../../shared/kernel/index.ts';
import type { GetPublication, PublishToTopic } from '../../application/index.ts';
import { V1_SEND_ERRORS } from './v1-notifications.routes.ts';

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
    app.post(
      '/publications',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: doc({
          tag: 'v1',
          summary: 'Publish one message to everyone following a topic (at most 100 recipients).',
          description:
            '202 = one email per recipient created, NOT sent yet; follow with `GET /v1/publications/{id}`. Recipients are fixed at call time by the same consent rules as a single send. ' +
            'More than 100 followers -> `PUBLICATION_TOO_LARGE` and nobody gets the email; nobody following is not an error (`recipientCount: 0`). ' +
            '`idempotencyKey` is REQUIRED and stands for "this publication": the same key again returns 200 with the earlier publication. ' +
            'Content is `subject` + `html` (+ `text`) OR `templateId` + `payload`, like `POST /v1/notifications`; everyone gets the same payload, `{{ user.external_id }}` is filled per person.',
          body: publishBody,
          example: {
            topic: 'bao_tri',
            subject: 'Maintenance tonight 22:00',
            html: '<p>The system is down from 22:00 to 23:00.</p>',
            text: 'The system is down from 22:00 to 23:00.',
            idempotencyKey: 'bao-tri-2026-10-10',
          },
          status: 202,
          responseDto: 'PublicationDto',
          errors: [{ status: 422, code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 422, code: 'PUBLICATION_TOO_LARGE' }, ...V1_SEND_ERRORS],
        }),
      },
      async (request, reply) => {
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
            apiRateLimitPerMinute: caller.rateLimitPerMinute,
          },
          ctx,
        );
        return reply
          .status(created ? 202 : 200)
          .header('location', `/v1/publications/${publication.id}`)
          .send(publication);
      },
    );

    app.get(
      '/publications/:id',
      {
        config: doc({
          tag: 'v1',
          summary: 'Get the progress of one publication: counts and one row per recipient.',
          description: '`status` is `in_progress` while some emails are still pending, `completed` when all have an outcome. Another app\'s publication is 404.',
          params: idParams,
          responseDto: 'PublicationDto',
          errors: [{ status: 404, code: 'NOT_FOUND' }],
        }),
      },
      async (request) => {
        const { id } = parseInput(idParams, request.params);
        return useCases.get.execute({ appId: appCaller(request).appId, id: PublicationId.parse(id) });
      },
    );
  };
}
