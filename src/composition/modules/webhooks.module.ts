import type { GetNotificationOutcome } from '../../modules/notifications/application/index.ts';
import type { SystemSettingsQueries } from '../../modules/settings/application/index.ts';
import {
  CreateWebhookEndpoint,
  DeleteWebhookEndpoint,
  DeliverDueWebhooks,
  DispatchNotificationWebhook,
  RotateWebhookSecret,
  SendTestWebhook,
  UpdateWebhookEndpoint,
  WebhookQueries,
  type WebhookSecrets,
  type WebhookTransport,
} from '../../modules/webhooks/application/index.ts';
import {
  DisabledWebhookSecrets,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
  HmacWebhookSecrets,
  HttpsWebhookTransport,
  NotificationsOutcomeLookup,
  SettingsWebhookLimits,
} from '../../modules/webhooks/infrastructure/adapters/index.ts';
import { adminWebhooksRoutes, deliverWebhooksJob, webhookDispatcherHandler } from '../../modules/webhooks/interface/index.ts';
import { STREAMS } from '../../shared/streams/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module webhooks (outgoing webhook — ADR-0029) — cắm vào CẢ BA process:
 *   api       /admin/apps/:appId/webhooks/* (quản lý URL, gửi thử, nhật ký gọi)
 *   worker    consumer `webhook-dispatcher` (webhook.events -> ghi lượt gọi)
 *   scheduler job `deliver-webhooks` (gọi ra URL của app, gọi lại theo lịch)
 */
export function webhooksModule(
  container: Container,
  dependencies: {
    notificationOutcomes: GetNotificationOutcome;
    systemSettings: SystemSettingsQueries;
    /** Test thay bằng bản giả — không gọi mạng thật. */
    transport?: WebhookTransport | undefined;
  },
): ModuleDefinition {
  const { uow, outbox, clock, logger } = container.ports;
  const { transactions } = container.infra;
  const signingKey = container.env.WEBHOOK_SIGNING_KEY;

  const endpoints = new DrizzleWebhookEndpointRepository({ transactions });
  const deliveries = new DrizzleWebhookDeliveryRepository({ transactions });
  const secrets: WebhookSecrets = signingKey ? new HmacWebhookSecrets({ signingKey }) : new DisabledWebhookSecrets();
  const transport = dependencies.transport ?? new HttpsWebhookTransport();
  const manage = { uow, outbox, clock, endpoints, deliveries, secrets };

  return {
    name: 'webhooks',
    http: {
      admin: [
        adminWebhooksRoutes({
          queries: new WebhookQueries({ endpoints, deliveries, secrets }),
          create: new CreateWebhookEndpoint({ ...manage, limits: new SettingsWebhookLimits({ systemSettings: dependencies.systemSettings }) }),
          update: new UpdateWebhookEndpoint(manage),
          rotateSecret: new RotateWebhookSecret(manage),
          remove: new DeleteWebhookEndpoint(manage),
          sendTest: new SendTestWebhook({ uow, clock, endpoints, deliveries, secrets, transport }),
        }),
      ],
    },
    consumers: [
      {
        group: 'webhook-dispatcher',
        stream: STREAMS.WEBHOOK_EVENTS,
        handler: webhookDispatcherHandler({
          dispatch: new DispatchNotificationWebhook({
            uow,
            clock,
            outcomes: new NotificationsOutcomeLookup(dependencies),
            endpoints,
            deliveries,
          }),
        }),
      },
    ],
    jobs: [
      deliverWebhooksJob({
        deliverDue: new DeliverDueWebhooks({ uow, clock, logger, endpoints, deliveries, secrets, transport }),
      }),
    ],
  };
}
