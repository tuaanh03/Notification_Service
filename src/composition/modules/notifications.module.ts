import type { SendEmail, SendRateLimiter } from '../../modules/delivery/application/index.ts';
import type { FindUserByExternalId } from '../../modules/directory/application/index.ts';
import {
  AcceptEmailNotification,
  DeliverEmailNotification,
  FailStuckSending,
  GetAppOverview,
  GetNotification,
  ListNotifications,
} from '../../modules/notifications/application/index.ts';
import {
  DeliveryEmailSender,
  DirectoryRecipientLookup,
  DrizzleNotificationRepository,
  DrizzleNotificationStats,
  DrizzleRecipientRepository,
  SubscriptionsEmailLookup,
  TemplatesLabels,
  TemplatesRenderer,
  TopicsConsentLookup,
} from '../../modules/notifications/infrastructure/adapters/index.ts';
import {
  adminNotificationsRoutes,
  emailSenderHandler,
  failStuckSendingJob,
  v1NotificationsRoutes,
} from '../../modules/notifications/interface/index.ts';
import type { FindUserEmail } from '../../modules/subscriptions/application/index.ts';
import type { RenderTemplate, TemplateQueries } from '../../modules/templates/application/index.ts';
import type { ConsentQueries } from '../../modules/topics/application/index.ts';
import { STREAMS } from '../../shared/streams/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module notifications — cắm vào CẢ BA process:
 *   api       POST/GET /v1/notifications · GET /admin/apps/:appId/notifications (lịch sử gửi, chỉ đọc)
 *             · GET /admin/apps/:appId/overview (màn Tổng quan, chỉ đọc)
 *   worker    consumer `email-sender` (notif.queued, idempotency: 'handler')
 *   scheduler job `fail-stuck-sending`
 */
export function notificationsModule(
  container: Container,
  dependencies: {
    findUser: FindUserByExternalId;
    findUserEmail: FindUserEmail;
    consentQueries: ConsentQueries;
    sendEmail: SendEmail;
    sendRateLimiter: SendRateLimiter;
    renderTemplate: RenderTemplate;
    templateQueries: TemplateQueries;
  },
): { definition: ModuleDefinition } {
  const { uow, outbox, clock, logger } = container.ports;
  const { transactions } = container.infra;

  const notifications = new DrizzleNotificationRepository({ transactions });
  const recipients = new DrizzleRecipientRepository({ transactions });
  const topics = new TopicsConsentLookup(dependencies);
  const users = new DirectoryRecipientLookup(dependencies);
  const emails = new SubscriptionsEmailLookup(dependencies);
  const templates = new TemplatesLabels(dependencies);

  return {
    definition: {
      name: 'notifications',
      http: {
        admin: [
          adminNotificationsRoutes({
            list: new ListNotifications({ notifications, recipients, users, topics, templates }),
            overview: new GetAppOverview({ clock, stats: new DrizzleNotificationStats({ transactions }), users, emails, topics }),
          }),
        ],
        v1: [
          v1NotificationsRoutes({
            accept: new AcceptEmailNotification({
              uow,
              outbox,
              clock,
              notifications,
              recipients,
              users,
              topics,
              renderer: new TemplatesRenderer(dependencies),
              templates,
            }),
            get: new GetNotification({ notifications, recipients, topics, templates }),
          }),
        ],
      },
      consumers: [
        {
          group: 'email-sender',
          stream: STREAMS.NOTIF_QUEUED,
          options: { idempotency: 'handler' },
          handler: emailSenderHandler({
            deliver: new DeliverEmailNotification({
              uow,
              outbox,
              clock,
              logger,
              notifications,
              recipients,
              emails,
              topics,
              sender: new DeliveryEmailSender(dependencies),
            }),
          }),
        },
      ],
      jobs: [
        failStuckSendingJob({
          failStuckSending: new FailStuckSending({
            uow,
            outbox,
            clock,
            logger,
            notifications,
            recipients,
            stuckAfterMs: container.env.EMAIL_STUCK_SENDING_AFTER_MS,
          }),
        }),
      ],
    },
  };
}
