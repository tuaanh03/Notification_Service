import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, adminContext, doc, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
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
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const ids = (params: unknown) => {
      const { appId, endpointId } = parseInput(endpointParams, params);
      return { appId: AppId.parse(appId), endpointId: WebhookEndpointId.parse(endpointId) };
    };
    const tag = 'webhooks';
    const notConfigured = { status: 503, code: 'WEBHOOK_NOT_CONFIGURED' };

    app.get(
      '/apps/:appId/webhooks',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag,
            summary: 'List the webhook URLs of an app. Secrets are never returned.',
            description: '`configured: false` means the server has no signing key: creating a URL, rotating a secret and sending a test all fail with 503 `WEBHOOK_NOT_CONFIGURED`.',
            params: appParams,
            responseDto: '{ configured: boolean; endpoints: WebhookEndpointDto[] }',
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.queries.list(AppId.parse(appId));
      },
    );

    app.post(
      '/apps/:appId/webhooks',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Add a webhook URL. The signing secret `whsec_…` is returned once.',
            description:
              'EWS POSTs each subscribed event to the URL, signed with `X-EWS-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. At least once, no ordering: anything but a 2xx within 10 s is retried (1 min, 5 min, 30 min, 2 h, 6 h). The URL must be `https://`, with no credentials, fragment, localhost or private IP. The number of URLs per app is a system setting (`webhooks.max_endpoints_per_app`). The secret cannot be read again — only rotated.',
            params: appParams,
            body: createBody,
            example: { url: 'https://hr.example.com/ews/webhook', events: ['notification.sent', 'notification.failed'] },
            status: 201,
            responseDto: 'IssuedWebhookSecretDto',
            errors: [
              { status: 422, code: 'WEBHOOK_EVENTS_REQUIRED' },
              { status: 422, code: 'WEBHOOK_LIMIT_REACHED' },
              { status: 422, code: 'WEBHOOK_URL_INVALID' },
              notConfigured,
            ],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(createBody, request.body);
        const issued = await useCases.create.execute({ appId: AppId.parse(appId), url: body.url, events: body.events }, ctx(request));
        return reply.status(201).header('cache-control', 'no-store').send(issued);
      },
    );

    app.patch(
      '/apps/:appId/webhooks/:endpointId',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Change the events of a webhook URL, or disable / re-enable it.',
            description: 'Disabling fails every pending delivery of the URL (`endpoint_disabled`); re-enabling does not replay past events. The URL itself cannot be changed — delete it and add a new one.',
            params: endpointParams,
            body: updateBody,
            responseDto: 'WebhookEndpointDto',
            errors: [{ status: 422, code: 'WEBHOOK_EVENTS_REQUIRED' }],
          }),
        },
      },
      async (request) => {
        const body = parseInput(updateBody, request.body);
        return useCases.update.execute({ ...ids(request.params), events: body.events, status: body.status }, ctx(request));
      },
    );

    app.post(
      '/apps/:appId/webhooks/:endpointId/rotate-secret',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Rotate the signing secret of a webhook URL. The new `whsec_…` is returned once.',
            description: 'The old secret stops working from the next delivery on.',
            params: endpointParams,
            responseDto: 'IssuedWebhookSecretDto',
            errors: [notConfigured],
          }),
        },
      },
      async (request, reply) => {
        const issued = await useCases.rotateSecret.execute(ids(request.params), ctx(request));
        return reply.header('cache-control', 'no-store').send(issued);
      },
    );

    app.delete(
      '/apps/:appId/webhooks/:endpointId',
      {
        config: {
          ...access('app.manage'),
          ...doc({ tag, summary: 'Delete a webhook URL together with its delivery log. Pending deliveries are dropped.', params: endpointParams, status: 204 }),
        },
      },
      async (request, reply) => {
        await useCases.remove.execute(ids(request.params), ctx(request));
        return reply.status(204).send();
      },
    );

    app.post(
      '/apps/:appId/webhooks/:endpointId/test',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Send a signed `ping` event to a webhook URL now and return the result.',
            description: 'Waits up to 10 seconds for your URL. Never retried; recorded in the delivery log. Works on a disabled URL too.',
            params: endpointParams,
            responseDto: 'WebhookDeliveryDto',
            errors: [notConfigured],
          }),
        },
      },
      async (request) => {
        return useCases.sendTest.execute(ids(request.params));
      },
    );

    app.get(
      '/apps/:appId/webhooks/:endpointId/deliveries',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'List the latest 50 deliveries of a webhook URL. No bodies, no responses.', params: endpointParams, responseDto: 'WebhookDeliveryDto[]' }),
        },
      },
      async (request) => {
        const { appId, endpointId } = ids(request.params);
        return useCases.queries.deliveries(appId, endpointId);
      },
    );
  };
}
