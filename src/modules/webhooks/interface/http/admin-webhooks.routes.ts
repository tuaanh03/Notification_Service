import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, WEBHOOK_ENDPOINT_STATUSES, WEBHOOK_EVENT_TYPES, WebhookEndpointId } from '../../../../shared/kernel/index.ts';
import type {
  CreateWebhookEndpoint,
  DeleteWebhookEndpoint,
  RotateWebhookSecret,
  SendTestWebhook,
  UpdateWebhookEndpoint,
  WebhookQueries,
} from '../../application/index.ts';

// Định dạng ở biên; luật URL (https, không IP nội bộ…) và luật danh sách sự kiện nằm ở domain.
const createBody = z.object({ url: z.string().min(1).max(4096), events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).max(10) }).strict();
const updateBody = z
  .object({ events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).max(10).optional(), status: z.enum(WEBHOOK_ENDPOINT_STATUSES).optional() })
  .strict();
const appParams = z.object({ appId: z.string().uuid() });
const endpointParams = z.object({ appId: z.string().uuid(), endpointId: z.string().uuid() });

/**
 * Quản lý URL nhận webhook của MỘT app (ADR-0029). Xem: `app.read`; thêm / sửa / đổi secret / xoá /
 * gửi thử: `app.manage`. Response có secret (`POST`, `rotate-secret`) không cache.
 */
export function adminWebhooksRoutes(useCases: {
  queries: WebhookQueries;
  create: CreateWebhookEndpoint;
  update: UpdateWebhookEndpoint;
  rotateSecret: RotateWebhookSecret;
  remove: DeleteWebhookEndpoint;
  sendTest: SendTestWebhook;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });
    const ids = (params: unknown) => {
      const { appId, endpointId } = parseInput(endpointParams, params);
      return { appId: AppId.parse(appId), endpointId: WebhookEndpointId.parse(endpointId) };
    };

    app.get('/apps/:appId/webhooks', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      return useCases.queries.list(AppId.parse(appId));
    });

    app.post('/apps/:appId/webhooks', { config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(createBody, request.body);
      const issued = await useCases.create.execute({ appId: AppId.parse(appId), url: body.url, events: body.events }, ctx(request));
      return reply.status(201).header('cache-control', 'no-store').send(issued);
    });

    app.patch('/apps/:appId/webhooks/:endpointId', { config: access('app.manage') }, async (request) => {
      const body = parseInput(updateBody, request.body);
      return useCases.update.execute({ ...ids(request.params), events: body.events, status: body.status }, ctx(request));
    });

    app.post('/apps/:appId/webhooks/:endpointId/rotate-secret', { config: access('app.manage') }, async (request, reply) => {
      const issued = await useCases.rotateSecret.execute(ids(request.params), ctx(request));
      return reply.header('cache-control', 'no-store').send(issued);
    });

    app.delete('/apps/:appId/webhooks/:endpointId', { config: access('app.manage') }, async (request, reply) => {
      await useCases.remove.execute(ids(request.params), ctx(request));
      return reply.status(204).send();
    });

    app.post('/apps/:appId/webhooks/:endpointId/test', { config: access('app.manage') }, async (request) => {
      return useCases.sendTest.execute(ids(request.params));
    });

    app.get('/apps/:appId/webhooks/:endpointId/deliveries', { config: access('app.read') }, async (request) => {
      const { appId, endpointId } = ids(request.params);
      return useCases.queries.deliveries(appId, endpointId);
    });
  };
}
