import type { AuthorizeAppIngress } from '../../modules/apps/application/index.ts';
import {
  CreateIncomingHook,
  DeleteIncomingHook,
  IncomingHookQueries,
  PreviewIncomingHook,
  PurgeIncomingCalls,
  ReceiveIncomingCall,
  RotateIncomingHookToken,
  UpdateIncomingHook,
} from '../../modules/incoming/application/index.ts';
import {
  AppsIngress,
  DrizzleIncomingCallRepository,
  DrizzleIncomingHookRepository,
  NodeHookCrypto,
  NotificationsPublisher,
  RedisHookRateLimiter,
  SettingsReader,
  TemplatesCatalog,
  TopicsCatalog,
} from '../../modules/incoming/infrastructure/adapters/index.ts';
import { adminIncomingHooksRoutes, publicHooksRoutes, purgeIncomingCallsJob } from '../../modules/incoming/interface/index.ts';
import type { PublishToTopic } from '../../modules/notifications/application/index.ts';
import type { SystemSettingsQueries } from '../../modules/settings/application/index.ts';
import type { RenderTemplate, TemplateQueries } from '../../modules/templates/application/index.ts';
import type { ConsentQueries } from '../../modules/topics/application/index.ts';
import { statusOfDomainError } from '../../shared/http/index.ts';
import { FixedWindowRateLimiter } from '../../shared/rate-limit/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module incoming (incoming webhook — ADR-0030):
 *   api       POST /hooks/:token (công khai) · /admin/apps/:appId/incoming-webhooks/*
 *   scheduler job `purge-incoming-calls`
 */
export function incomingModule(
  container: Container,
  dependencies: {
    authorizeAppIngress: AuthorizeAppIngress;
    templateQueries: TemplateQueries;
    renderTemplate: RenderTemplate;
    consentQueries: ConsentQueries;
    publishToTopic: PublishToTopic;
    systemSettings: SystemSettingsQueries;
  },
): ModuleDefinition {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const hooks = new DrizzleIncomingHookRepository({ transactions });
  const calls = new DrizzleIncomingCallRepository({ transactions });
  const crypto = new NodeHookCrypto();
  const templates = new TemplatesCatalog(dependencies);
  const topics = new TopicsCatalog(dependencies);
  const settings = new SettingsReader(dependencies);
  const manage = { uow, outbox, clock, hooks, calls, crypto, topics, templates, settings };

  return {
    name: 'incoming',
    http: {
      public: [
        publicHooksRoutes({
          receive: new ReceiveIncomingCall({
            clock,
            hooks,
            calls,
            crypto,
            ingress: new AppsIngress(dependencies),
            templates,
            topics,
            publisher: new NotificationsPublisher(dependencies),
            settings,
            limiter: new RedisHookRateLimiter({
              limiter: new FixedWindowRateLimiter({
                redis: container.infra.redis.client,
                clock,
                sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              }),
            }),
            httpStatusOf: statusOfDomainError,
          }),
        }),
      ],
      admin: [
        adminIncomingHooksRoutes({
          queries: new IncomingHookQueries({ hooks, calls, templates, topics, settings }),
          create: new CreateIncomingHook(manage),
          update: new UpdateIncomingHook(manage),
          rotateToken: new RotateIncomingHookToken(manage),
          remove: new DeleteIncomingHook(manage),
          preview: new PreviewIncomingHook({ crypto, templates, topics, settings }),
        }),
      ],
    },
    jobs: [purgeIncomingCallsJob({ purge: new PurgeIncomingCalls({ clock, calls }) })],
  };
}
