import type { AppQueries } from '../../modules/apps/application/index.ts';
import type { SendEmail, SendRateLimiter } from '../../modules/delivery/application/index.ts';
import type { FindUserByExternalId } from '../../modules/directory/application/index.ts';
import {
  AcceptEmailNotification,
  DeliverEmailNotification,
  FailStuckSending,
  GetAppOverview,
  GetNotification,
  GetNotificationOutcome,
  GetPublication,
  ListNotifications,
  GetOpenTracking,
  GetTemplateStats,
  ListTemplateRecipients,
  ListTemplateSendStats,
  PromoteScheduled,
  PublishToTopic,
  RecordEmailOpen,
  SendFromConsole,
} from '../../modules/notifications/application/index.ts';
import {
  AppsOpenTrackingConfig,
  AppsSendingLookup,
  AppsSendPolicyLookup,
  DeliveryEmailSender,
  DirectoryRecipientLookup,
  DrizzleNotificationRepository,
  DrizzleNotificationStats,
  DrizzlePublicationRepository,
  DrizzleRecipientRepository,
  HmacOpenTrackingSigner,
  RedisSendQuota,
  RedisSendSlotReserver,
  SubscriptionsEmailLookup,
  TemplatesLabels,
  TemplatesVersionLookup,
  DrizzleTemplateStats,
  TemplatesRenderer,
  TopicsConsentLookup,
} from '../../modules/notifications/infrastructure/adapters/index.ts';
import {
  adminNotificationsRoutes,
  emailSenderHandler,
  failStuckSendingJob,
  promoteScheduledJob,
  publicTrackingRoutes,
  v1NotificationsRoutes,
  v1PublicationsRoutes,
} from '../../modules/notifications/interface/index.ts';
import type { SystemSettingsQueries } from '../../modules/settings/application/index.ts';
import type { FindUserEmail } from '../../modules/subscriptions/application/index.ts';
import type { RenderTemplate, TemplateQueries } from '../../modules/templates/application/index.ts';
import type { ConsentQueries } from '../../modules/topics/application/index.ts';
import { STREAMS } from '../../shared/streams/index.ts';
import { MinuteSlotAllocator, WindowQuota } from '../../shared/rate-limit/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module notifications — cắm vào CẢ BA process:
 *   api       POST /admin/apps/:appId/notifications · POST /admin/apps/:appId/publications (màn Soạn thông báo, origin dashboard)
 *             · GET /t/o/:notificationId/:sig.gif (công khai — ảnh đếm "đã mở", ADR-0031)
 *             · POST/GET /v1/notifications · POST/GET /v1/publications (phát vào topic, ADR-0028) · GET /admin/apps/:appId/notifications (lịch sử gửi, chỉ đọc)
 *             · GET /admin/apps/:appId/overview (màn Tổng quan, chỉ đọc) · GET /admin/apps/:appId/open-tracking
 *   worker    consumer `email-sender` (notif.queued, idempotency: 'handler')
 *   scheduler job `promote-scheduled` (thư chờ khung giờ gửi tới giờ -> queued, ADR-0032) · `fail-stuck-sending`
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
    appQueries: AppQueries;
    systemSettings: SystemSettingsQueries;
  },
): { definition: ModuleDefinition; notificationOutcomes: GetNotificationOutcome; publishToTopic: PublishToTopic } {
  const { uow, outbox, clock, logger } = container.ports;
  const { transactions } = container.infra;

  const notifications = new DrizzleNotificationRepository({ transactions });
  const recipients = new DrizzleRecipientRepository({ transactions });
  const topics = new TopicsConsentLookup(dependencies);
  const users = new DirectoryRecipientLookup(dependencies);
  const emails = new SubscriptionsEmailLookup(dependencies);
  const templates = new TemplatesLabels(dependencies);
  const renderer = new TemplatesRenderer(dependencies);
  const templateVersions = new TemplatesVersionLookup(dependencies);
  const templateStats = new DrizzleTemplateStats({ transactions });
  const publications = new DrizzlePublicationRepository({ transactions });
  const policies = new AppsSendPolicyLookup(dependencies);
  // Dàn đều (ADR-0032 GĐ 2): lượt gửi mỗi phút của từng app, đếm chung mọi process trên Redis.
  const slots = new RedisSendSlotReserver({ allocator: new MinuteSlotAllocator({ redis: container.infra.redis.client }), clock });
  // Hạn mức GĐ 3 (ADR-0032): trần mỗi giờ lúc nhận (api) + mỗi người / ngày lúc gửi (worker) — cùng một Redis.
  const quota = new RedisSendQuota({ quota: new WindowQuota({ redis: container.infra.redis.client, keyPrefix: 'quota' }) });
  const accept = new AcceptEmailNotification({
    uow,
    outbox,
    clock,
    notifications,
    recipients,
    users,
    topics,
    renderer,
    templates,
    policies,
    slots,
    quota,
  });
  const signer = new HmacOpenTrackingSigner({ signingKey: container.env.WEBHOOK_SIGNING_KEY });
  const tracking = new AppsOpenTrackingConfig(dependencies);
  const publishToTopic = new PublishToTopic({
    uow,
    outbox,
    clock,
    publications,
    notifications,
    users,
    emails,
    topics,
    renderer,
    templates,
    policies,
    slots,
    quota,
  });

  return {
    publishToTopic,
    notificationOutcomes: new GetNotificationOutcome({ notifications, recipients, users, topics }),
    definition: {
      name: 'notifications',
      http: {
        public: [publicTrackingRoutes({ recordOpen: new RecordEmailOpen({ uow, outbox, clock, signer, recipients }) })],
        admin: [
          adminNotificationsRoutes({
            list: new ListNotifications({ notifications, recipients, users, topics, templates }),
            overview: new GetAppOverview({ clock, stats: new DrizzleNotificationStats({ transactions }), users, emails, topics }),
            openTracking: new GetOpenTracking({ tracking, signer }),
            send: new SendFromConsole({ accept, publish: publishToTopic, apps: new AppsSendingLookup(dependencies) }),
            templateStats: new GetTemplateStats({ clock, stats: templateStats, versions: templateVersions }),
            templateRecipients: new ListTemplateRecipients({ clock, stats: templateStats, versions: templateVersions, users, topics }),
            templateSendStats: new ListTemplateSendStats({ clock, stats: templateStats, templates }),
          }),
        ],
        v1: [
          v1NotificationsRoutes({
            accept,
            get: new GetNotification({ notifications, recipients, topics, templates }),
          }),
          v1PublicationsRoutes({
            publish: publishToTopic,
            get: new GetPublication({ publications, notifications, users, topics, templates }),
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
              tracking,
              signer,
              policies,
              quota,
            }),
          }),
        },
      ],
      jobs: [
        promoteScheduledJob({ promoteScheduled: new PromoteScheduled({ uow, outbox, clock, logger, notifications }) }),
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
