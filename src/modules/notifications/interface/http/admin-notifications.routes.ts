import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, EXTERNAL_ID, LARGE_BODY_LIMIT_BYTES, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, NOTIFICATION_STATUSES, TemplateId } from '../../../../shared/kernel/index.ts';
import {
  MAX_CONSOLE_RECIPIENTS,
  MAX_NOTIFICATION_PAGE,
  MAX_TEMPLATE_RECIPIENT_PAGE,
  RECIPIENT_BUCKETS,
  TEMPLATE_STATS_DAYS,
  type GetAppOverview,
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
  openTracking: GetOpenTracking;
  send: SendFromConsole;
  templateStats: GetTemplateStats;
  templateRecipients: ListTemplateRecipients;
  templateSendStats: ListTemplateSendStats;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });
    const content = (body: z.infer<typeof publishBody>) => ({
      topic: body.topic,
      subject: body.subject,
      html: body.html,
      text: body.text,
      templateId: body.templateId === undefined ? undefined : TemplateId.parse(body.templateId),
      payload: body.payload,
      requestId: body.requestId,
    });

    app.post('/apps/:appId/notifications', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(sendBody, request.body);
      const result = await useCases.send.toPeople({ ...content(body), appId: AppId.parse(appId), externalIds: body.externalIds }, ctx(request));
      return reply.status(202).send(result);
    });

    app.post('/apps/:appId/publications', { bodyLimit: LARGE_BODY_LIMIT_BYTES, config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(publishBody, request.body);
      return reply.status(202).send(await useCases.send.toTopic({ ...content(body), appId: AppId.parse(appId) }, ctx(request)));
    });

    app.get('/apps/:appId/notifications', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { limit, offset, status, topic, externalId } = parseInput(listQuery, request.query);
      return useCases.list.execute({ appId: AppId.parse(appId), limit, offset, status, topic, externalId });
    });

    app.get('/apps/:appId/overview', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.overview.execute({ appId: AppId.parse(appId) });
    });

    // Số liệu template (UX-24) — tab "Hiệu quả" + hai cột ở màn danh sách template.
    app.get('/apps/:appId/templates/:templateId/stats', { config: access('app.read') }, async (request) => {
      const { appId, templateId } = parseInput(templateParams, request.params);
      const { days, version } = parseInput(templateStatsQuery, request.query);
      return useCases.templateStats.execute({ appId: AppId.parse(appId), templateId: TemplateId.parse(templateId), days, version });
    });

    app.get('/apps/:appId/templates/:templateId/stats/recipients', { config: access('app.read') }, async (request) => {
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
    });

    app.get('/apps/:appId/template-stats', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { days } = parseInput(z.object({ days: statsDays }), request.query);
      return useCases.templateSendStats.execute({ appId: AppId.parse(appId), days });
    });

    // Đọc cờ đếm "đã mở" + server đã sẵn sàng chưa (ADR-0031). Đổi cờ: `PUT` cùng đường, module apps.
    app.get('/apps/:appId/open-tracking', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.openTracking.execute({ appId: AppId.parse(appId) });
    });
  };
}
