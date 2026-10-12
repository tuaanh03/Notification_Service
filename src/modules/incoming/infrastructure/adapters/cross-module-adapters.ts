import type { AuthorizeAppIngress } from '../../../apps/application/index.ts';
import type { PublishToTopic } from '../../../notifications/application/index.ts';
import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { RenderTemplate, TemplateQueries } from '../../../templates/application/index.ts';
import type { ConsentQueries } from '../../../topics/application/index.ts';
import type { FixedWindowRateLimiter } from '../../../../shared/rate-limit/index.ts';
import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AppId, Channel, TemplateId, TopicId } from '../../../../shared/kernel/index.ts';
import type {
  AppIngress,
  HookRateLimiter,
  IncomingSettings,
  TemplateCatalog,
  TemplateInfo,
  TopicCatalog,
  TopicPublisher,
} from '../../application/ports/index.ts';

/** incoming -> apps. */
export class AppsIngress implements AppIngress {
  private readonly query: AuthorizeAppIngress;

  constructor(deps: { authorizeAppIngress: AuthorizeAppIngress }) {
    this.query = deps.authorizeAppIngress;
  }

  authorize(input: { appId: AppId; ip: string }): Promise<{ grantedChannels: readonly Channel[] }> {
    return this.query.execute(input);
  }
}

/** incoming -> templates. */
export class TemplatesCatalog implements TemplateCatalog {
  private readonly queries: TemplateQueries;
  private readonly renderer: RenderTemplate;

  constructor(deps: { templateQueries: TemplateQueries; renderTemplate: RenderTemplate }) {
    this.queries = deps.templateQueries;
    this.renderer = deps.renderTemplate;
  }

  publishedVariables(appId: AppId, templateId: TemplateId): Promise<TemplateInfo | null> {
    return this.queries.publishedVariables(appId, templateId);
  }

  async render(appId: AppId, templateId: TemplateId, payload: Readonly<Record<string, unknown>>) {
    const rendered = await this.renderer.execute({ appId, templateId, payload, externalId: 'preview' });
    return { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }
}

/** incoming -> topics. */
export class TopicsCatalog implements TopicCatalog {
  private readonly consent: ConsentQueries;

  constructor(deps: { consentQueries: ConsentQueries }) {
    this.consent = deps.consentQueries;
  }

  async topicsOf(appId: AppId): Promise<{ topicId: TopicId; key: string; status: string; mandatory: boolean }[]> {
    return (await this.consent.topicsByApp(appId)).map((t) => ({ topicId: t.topicId, key: t.key, status: t.status, mandatory: t.mandatory }));
  }
}

/** incoming -> notifications (`PublishToTopic`, ADR-0028). */
export class NotificationsPublisher implements TopicPublisher {
  private readonly publishToTopic: PublishToTopic;

  constructor(deps: { publishToTopic: PublishToTopic }) {
    this.publishToTopic = deps.publishToTopic;
  }

  async publish(
    input: {
      appId: AppId;
      grantedChannels: readonly Channel[];
      topic: string;
      templateId: TemplateId;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    },
    ctx: CommandContext,
  ): Promise<{ publicationId: string; recipientCount: number; created: boolean }> {
    const { publication, created } = await this.publishToTopic.execute(input, ctx);
    return { publicationId: publication.id, recipientCount: publication.recipientCount, created };
  }
}

/** incoming -> settings. */
export class SettingsReader implements IncomingSettings {
  private readonly queries: SystemSettingsQueries;

  constructor(deps: { systemSettings: SystemSettingsQueries }) {
    this.queries = deps.systemSettings;
  }

  async current() {
    const values = await this.queries.current();
    return {
      dedupeWindowMinutes: values['incoming.dedupe_window_minutes'],
      maxPublicationsPerMinute: values['incoming.max_publications_per_minute'],
      publicBaseUrl: values['api.public_base_url'],
    };
  }
}

/** Giới hạn mỗi hook trên Redis (cửa sổ 1 phút, đếm chung mọi bản api). */
export class RedisHookRateLimiter implements HookRateLimiter {
  private readonly limiter: FixedWindowRateLimiter;

  constructor(deps: { limiter: FixedWindowRateLimiter }) {
    this.limiter = deps.limiter;
  }

  async tryAcquire(hookId: string, limitPerMinute: number): Promise<boolean> {
    return (await this.limiter.tryAcquire(`incoming-hook:${hookId}`, limitPerMinute)).allowed;
  }
}
