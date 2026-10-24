import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, adminContext, doc, EXTERNAL_ID, type HttpRoutes, LARGE_BODY_LIMIT_BYTES, parseInput } from '../../../../shared/http/index.ts';
import { AppId, NOTIFICATION_STATUSES, TemplateId } from '../../../../shared/kernel/index.ts';
import {
  MAX_CONSOLE_RECIPIENTS,
  MAX_NOTIFICATION_PAGE,
  MAX_TEMPLATE_RECIPIENT_PAGE,
  RECIPIENT_BUCKETS,
  TEMPLATE_STATS_DAYS,
  type GetAppOverview,
  type GetDeliveryQueue,
  type GetOpenTracking,
  type GetTemplateStats,
  type ListNotifications,
  type ListTemplateRecipients,
  type ListTemplateSendStats,
  type SendFromConsole,
} from '../../application/index.ts';

const appParams = z.object({ appId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  /** `key` của chủ đề, khớp đúng. */
  topic: z.string().min(1).max(128).optional(),
  /** Mã người nhận phía app, khớp đúng. */
  externalId: EXTERNAL_ID.optional(),
});

/** Nội dung như `/v1` — viết thẳng HOẶC template + payload (command kiểm loại trừ nhau). */
const consoleContent = {
  topic: z.string().min(1).max(128),
  subject: z.string().optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  templateId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  /** Một lần soạn trên console — bấm Gửi lại không thành thư thứ hai. */
  requestId: z.string().uuid(),
};
const sendBody = z
  .object({ ...consoleContent, externalIds: z.array(EXTERNAL_ID).min(1).max(MAX_CONSOLE_RECIPIENTS) })
  .strict();
const publishBody = z.object(consoleContent).strict();

/** Số liệu template (UX-24): chỉ 7 / 30 / 90 ngày. */
const statsDays = z.coerce
  .number()
  .int()
  .refine((d): d is (typeof TEMPLATE_STATS_DAYS)[number] => (TEMPLATE_STATS_DAYS as readonly number[]).includes(d), 'days must be 7, 30 or 90')
  .default(30);
const templateParams = z.object({ appId: z.string().uuid(), templateId: z.string().uuid() });
const templateStatsQuery = z.object({ days: statsDays, version: z.coerce.number().int().min(1).optional() });
const templateRecipientsQuery = templateStatsQuery.extend({
  bucket: z.enum(RECIPIENT_BUCKETS).default('sent'),
  /** Tìm theo một phần địa chỉ email. */
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TEMPLATE_RECIPIENT_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const templateSendStatsQuery = z.object({ days: statsDays });

/**
 * `/admin/apps/:appId/notifications` — bề mặt ĐỌC cho vận hành (plan §5): lịch sử gửi của một app.
 * `/admin/apps/:appId/overview` — số liệu màn Tổng quan của app đó (24 giờ gần nhất + hàng chờ).
 * `/admin/apps/:appId/templates/:templateId/stats[/recipients]`, `/admin/apps/:appId/template-stats` —
 * số liệu theo template (UX-24).
 *
 * `appId` nằm trên URL chứ không suy từ token, cùng lý do với `/admin/apps/:appId/users`: khi có
 * RBAC (plan §12.4), vai `app_admin` chỉ cần thêm một lớp kiểm quyền trên chính tham số này.
 *
 * Ghi duy nhất: màn Soạn thông báo GỬI (`POST …/notifications` tới người cụ thể, `POST …/publications`
 * vào cả chủ đề) — `app.manage`, đi đúng đường `/v1`, `origin = 'dashboard'`. Không huỷ, không gửi lại.
 */
export function adminNotificationsRoutes(useCases: {
  list: ListNotifications;
  overview: GetAppOverview;
  deliveryQueue: GetDeliveryQueue;
  openTracking: GetOpenTracking;
  send: SendFromConsole;
  templateStats: GetTemplateStats;
  templateRecipients: ListTemplateRecipients;
  templateSendStats: ListTemplateSendStats;
}): HttpRoutes {
  return (app) => {
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const content = (body: z.infer<typeof publishBody>) => ({
      topic: body.topic,
      subject: body.subject,
      html: body.html,
      text: body.text,
      templateId: body.templateId === undefined ? undefined : TemplateId.parse(body.templateId),
      payload: body.payload,
      requestId: body.requestId,
    });

    const tag = 'notifications';
    // Cùng kiểm tra với `/v1` (chủ đề, nội dung, template) — xem bảng mã lỗi của App API.
    const sendIssues = [
      'APP_NOT_ACTIVE',
      'CHANNEL_NOT_GRANTED',
      'TOPIC_NOT_FOUND',
      'TOPIC_NOT_ACTIVE',
      'CONTENT_AND_TEMPLATE_CONFLICT',
      'PAYLOAD_REQUIRES_TEMPLATE',
      'EMAIL_SUBJECT_REQUIRED',
      'EMAIL_HTML_REQUIRED',
      'EMAIL_BODY_TOO_LARGE',
      'TEMPLATE_NOT_FOUND',
      'TEMPLATE_NOT_PUBLISHED',
      'TEMPLATE_ARCHIVED',
      'MISSING_VARIABLE',
      'INVALID_PAYLOAD_VALUE',
      'LINK_SCHEME_NOT_ALLOWED',
      'PAYLOAD_TOO_LARGE',
    ].map((code) => ({ status: 422, code }));
    const hourlyLimit = { status: 429, code: 'APP_HOURLY_LIMIT' };
    const contentRule =
      'Content is either `subject` + `html` (+ `text`) OR `templateId` + `payload`, never both. `requestId` identifies one compose on the console: re-sending the same `requestId` does not send twice. 202 = accepted, NOT delivered.';

    app.post(
      '/apps/:appId/notifications',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: `Send one email to each of up to ${MAX_CONSOLE_RECIPIENTS} chosen recipients (console compose).`,
            description: `${contentRule} A recipient that does not exist is reported in its own \`results[]\` row (\`code: RECIPIENT_NOT_FOUND\`); the others are still queued. More people: publish to the topic instead.`,
            params: appParams,
            body: sendBody,
            status: 202,
            responseDto: 'ConsoleSendResult',
            errors: [{ status: 422, code: 'RECIPIENTS_REQUIRED' }, { status: 422, code: 'TOO_MANY_RECIPIENTS' }, ...sendIssues, hourlyLimit],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(sendBody, request.body);
        const result = await useCases.send.toPeople({ ...content(body), appId: AppId.parse(appId), externalIds: body.externalIds }, ctx(request));
        return reply.status(202).send(result);
      },
    );

    app.post(
      '/apps/:appId/publications',
      {
        bodyLimit: LARGE_BODY_LIMIT_BYTES,
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Publish one message to everyone following a topic (console compose).',
            description: `${contentRule} Recipients are fixed at call time; more than 100 followers is \`PUBLICATION_TOO_LARGE\` and nobody gets the email.`,
            params: appParams,
            body: publishBody,
            status: 202,
            responseDto: 'PublicationDto',
            errors: [...sendIssues, { status: 422, code: 'PUBLICATION_TOO_LARGE' }, hourlyLimit],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(publishBody, request.body);
        return reply.status(202).send(await useCases.send.toTopic({ ...content(body), appId: AppId.parse(appId) }, ctx(request)));
      },
    );

    app.get(
      '/apps/:appId/notifications',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag,
            summary: 'List the send history of an app, newest first.',
            description:
              'No email address and no content in this list. `topic` and `externalId` match exactly. `sent` means the mail server accepted the email, not that it reached the inbox.',
            params: appParams,
            query: listQuery,
            responseDto: 'NotificationPageDto',
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const { limit, offset, status, topic, externalId } = parseInput(listQuery, request.query);
        return useCases.list.execute({ appId: AppId.parse(appId), limit, offset, status, topic, externalId });
      },
    );

    app.get(
      '/apps/:appId/overview',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'Get the overview numbers of an app: last 24 hours (UTC buckets) and the current queue.', params: appParams, responseDto: 'AppOverviewDto' }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.overview.execute({ appId: AppId.parse(appId) });
      },
    );

    // Hàng chờ gửi của cả hệ thống (ADR-0041) — chỉ Super Admin: thấy tên mọi app.
    app.get(
      '/delivery-queue',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Get the system-wide delivery queue: today\'s mailbox usage, pending and scheduled emails, apps with unfinished emails (Super Admin only).',
            responseDto: 'DeliveryQueueDto',
          }),
        },
      },
      async () => useCases.deliveryQueue.execute(),
    );

    // Số liệu template (UX-24) — tab "Hiệu quả" + hai cột ở màn danh sách template.
    app.get(
      '/apps/:appId/templates/:templateId/stats',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag: 'templates',
            summary: 'Get send statistics of one template over 7, 30 or 90 days (optionally one version).',
            description: 'Only what EWS measures: handed over to the mail server, failed, skipped, and an estimated open rate (only emails with the tracking pixel count).',
            params: templateParams,
            query: templateStatsQuery,
            responseDto: 'TemplateStatsDto',
          }),
        },
      },
      async (request) => {
        const { appId, templateId } = parseInput(templateParams, request.params);
        const { days, version } = parseInput(templateStatsQuery, request.query);
        return useCases.templateStats.execute({ appId: AppId.parse(appId), templateId: TemplateId.parse(templateId), days, version });
      },
    );

    app.get(
      '/apps/:appId/templates/:templateId/stats/recipients',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag: 'templates',
            summary: 'List recipients of one template in a bucket (sent, opened, unopened, failed, skipped).',
            description: '`q` matches part of the email address.',
            params: templateParams,
            query: templateRecipientsQuery,
            responseDto: 'TemplateRecipientPageDto',
          }),
        },
      },
      async (request) => {
        const { appId, templateId } = parseInput(templateParams, request.params);
        const { days, version, bucket, q, limit, offset } = parseInput(templateRecipientsQuery, request.query);
        return useCases.templateRecipients.execute({
          appId: AppId.parse(appId),
          templateId: TemplateId.parse(templateId),
          days,
          version,
          bucket,
          search: q,
          limit,
          offset,
        });
      },
    );

    app.get(
      '/apps/:appId/template-stats',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag: 'templates', summary: 'Get sent count and open rate of every template of an app over 7, 30 or 90 days.', params: appParams, query: templateSendStatsQuery, responseDto: 'TemplateSendStatsListDto' }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const { days } = parseInput(templateSendStatsQuery, request.query);
        return useCases.templateSendStats.execute({ appId: AppId.parse(appId), days });
      },
    );

    // Đọc cờ đếm "đã mở" + server đã sẵn sàng chưa (ADR-0031). Đổi cờ: `PUT` cùng đường, module apps.
    app.get(
      '/apps/:appId/open-tracking',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'Get whether open tracking is on for the app and whether the server is ready for it.', params: appParams, responseDto: 'OpenTrackingDto' }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.openTracking.execute({ appId: AppId.parse(appId) });
      },
    );
  };
}
