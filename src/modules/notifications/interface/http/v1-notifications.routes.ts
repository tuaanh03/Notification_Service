import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { appCaller, doc, EXTERNAL_ID, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
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

/** Lỗi nghiệp vụ của gửi / phát qua `/v1` (bảng mục 8 của `huong-dan-tich-hop-cho-doi-app.md`). */
export const V1_SEND_ERRORS: ReadonlyArray<{ status: number; code: string }> = [
  ...[
    'TOPIC_NOT_FOUND',
    'TOPIC_NOT_ACTIVE',
    'CHANNEL_NOT_GRANTED',
    'CONTENT_AND_TEMPLATE_CONFLICT',
    'PAYLOAD_REQUIRES_TEMPLATE',
    'EMAIL_SUBJECT_REQUIRED',
    'EMAIL_SUBJECT_TOO_LONG',
    'EMAIL_SUBJECT_INVALID',
    'EMAIL_HTML_REQUIRED',
    'EMAIL_BODY_TOO_LARGE',
    'TEMPLATE_NOT_FOUND',
    'TEMPLATE_NOT_PUBLISHED',
    'TEMPLATE_ARCHIVED',
    'MISSING_VARIABLE',
    'INVALID_PAYLOAD_VALUE',
    'LINK_SCHEME_NOT_ALLOWED',
    'PAYLOAD_TOO_LARGE',
  ].map((code) => ({ status: 422, code })),
  { status: 429, code: 'APP_HOURLY_LIMIT' },
];

/**
 * `POST /v1/notifications` — xếp hàng một email (nội dung viết thẳng hoặc template đã xuất bản). 202 = ĐÃ NHẬN, CHƯA gửi (SM-4): theo dõi
 * bằng `GET /v1/notifications/:id`. Trùng `idempotencyKey` -> 200 kèm bản cũ, không gửi lần hai.
 */
export function v1NotificationsRoutes(useCases: { accept: AcceptEmailNotification; get: GetNotification }): HttpRoutes {
  return (app) => {
    app.post(
      '/notifications',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: doc({
          tag: 'v1',
          summary: 'Queue one email to one recipient.',
          description:
            '202 = ACCEPTED, NOT delivered: the email is queued (or `scheduled` by the app sending limits); follow it with `GET /v1/notifications/{id}` (also in the `Location` header). ' +
            'Content is either `subject` + `html` (+ `text`) OR `templateId` + `payload` (the published version is rendered now; missing data is rejected with 422), never both. ' +
            'Always send an `idempotencyKey` that stands for "this email, for this person": the same key again returns 200 with the earlier notification and sends nothing (content is not compared). ' +
            'The recipient must exist first (`PUT /v1/users/{externalId}`). `payload` is flat, at most 2 KB, values are strings, numbers or booleans.',
          body: sendBody,
          example: {
            to: { externalId: 'NV-0123' },
            topic: 'vm_alerts',
            templateId: '3f2a9c1e-7b4d-4e8a-9f10-2c6d5e8b1a73',
            payload: { vm_name: 'ai-gateway', threshold: 80 },
            idempotencyKey: 'vm-ai-gateway-high-load-2026-09-30T09:00-NV-0123',
          },
          status: 202,
          responseDto: 'NotificationDto',
          errors: [{ status: 422, code: 'RECIPIENT_NOT_FOUND' }, ...V1_SEND_ERRORS],
        }),
      },
      async (request, reply) => {
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
            apiRateLimitPerMinute: caller.rateLimitPerMinute,
          },
          ctx,
        );
        return reply
          .status(created ? 202 : 200)
          .header('location', `/v1/notifications/${notification.id}`)
          .send(notification);
      },
    );

    app.get(
      '/notifications/:id',
      {
        config: doc({
          tag: 'v1',
          summary: 'Get the status of one email.',
          description:
            '`sent` = the mail server accepted it, not necessarily the inbox. `no_recipient` = blocked, see `recipient.exclusionReason`. `failed` with `error` starting `outcome_unknown` = unknown whether it left; EWS never retries it. Another app\'s email is 404.',
          params: idParams,
          responseDto: 'NotificationDto',
          errors: [{ status: 404, code: 'NOT_FOUND' }],
        }),
      },
      async (request) => {
        const { id } = parseInput(idParams, request.params);
        return useCases.get.execute({ appId: appCaller(request).appId, id: NotificationId.parse(id) });
      },
    );
  };
}
