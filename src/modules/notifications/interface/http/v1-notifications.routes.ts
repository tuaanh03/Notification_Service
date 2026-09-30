import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, EXTERNAL_ID, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { NotificationId, TemplateId } from '../../../../shared/kernel/index.ts';
import type { AcceptEmailNotification, GetNotification } from '../../application/index.ts';

// Chỉ định dạng ở biên; giới hạn độ dài / byte của nội dung do EmailContent (domain) kiểm. Hai cách gửi —
// `subject` + `html` hoặc `templateId` + `payload` — loại trừ nhau: command kiểm (CONTENT_AND_TEMPLATE_CONFLICT).
const sendBody = z
  .object({
    to: z.object({ externalId: EXTERNAL_ID }).strict(),
    topic: z.string().min(1).max(128),
    subject: z.string().optional(),
    html: z.string().optional(),
    text: z.string().optional(),
    templateId: z.string().uuid().optional(),
    /** Khoá không khai trong template bị bỏ qua; ≤ 2 KB do Notification kiểm (PAYLOAD_TOO_LARGE). */
    payload: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();
const idParams = z.object({ id: z.string().uuid() });

/**
 * `POST /v1/notifications` — xếp hàng một email (nội dung viết thẳng hoặc template đã xuất bản). 202 = ĐÃ NHẬN, CHƯA gửi (SM-4): theo dõi
 * bằng `GET /v1/notifications/:id`. Trùng `idempotencyKey` -> 200 kèm bản cũ, không gửi lần hai.
 */
export function v1NotificationsRoutes(useCases: { accept: AcceptEmailNotification; get: GetNotification }): HttpRoutes {
  return (app) => {
    app.post('/notifications', { bodyLimit: LARGE_BODY_LIMIT_BYTES }, async (request, reply) => {
      const caller = appCaller(request);
      const body = parseInput(sendBody, request.body);
      const ctx: CommandContext = { actor: { id: caller.appId, type: 'app' }, source: 'v1_api' };
      const { notification, created } = await useCases.accept.execute(
        {
          appId: caller.appId,
          grantedChannels: caller.grantedChannels,
          externalId: body.to.externalId,
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
        .header('location', `/v1/notifications/${notification.id}`)
        .send(notification);
    });

    app.get('/notifications/:id', async (request) => {
      const { id } = parseInput(idParams, request.params);
      return useCases.get.execute({ appId: appCaller(request).appId, id: NotificationId.parse(id) });
    });
  };
}
