import type { AdminAuthenticator, AdminAuthorizer, ApiKeyAuthenticator, HttpRoutes, HttpSurfaces } from '../shared/http/index.ts';
import type { EmailProvider } from '../modules/delivery/application/index.ts';
import type { TemplateAiWriter } from '../modules/templates/application/index.ts';
import type { MicrosoftIdentity, TenantDirectory } from '../modules/tenancy/application/index.ts';
import type { WebhookTransport } from '../modules/webhooks/application/index.ts';
import type { Job } from '../shared/jobs/index.ts';
import type { ConsumerRegistration } from './consumer-registry.ts';
import type { Container } from './container.ts';
import type { ModuleDefinition } from './module-definition.ts';
import { appsModule } from './modules/apps.module.ts';
import { auditModule } from './modules/audit.module.ts';
import { deliveryModule } from './modules/delivery.module.ts';
import { notificationsModule } from './modules/notifications.module.ts';
import { directoryModule } from './modules/directory.module.ts';
import { subscriptionsModule } from './modules/subscriptions.module.ts';
import { templatesModule } from './modules/templates.module.ts';
import { topicsModule } from './modules/topics.module.ts';
import { webhooksModule } from './modules/webhooks.module.ts';
import { incomingModule } from './modules/incoming.module.ts';
import { settingsModule } from './modules/settings.module.ts';
import { tenancyModule, type AdminOps } from './modules/tenancy.module.ts';
import type { GrantAppRole } from '../modules/apps/application/index.ts';

/** Toàn bộ nghiệp vụ đã ghép, sẵn sàng cắm vào process. */
export interface Application {
  readonly modules: readonly ModuleDefinition[];
  readonly authenticators: { readonly apiKey: ApiKeyAuthenticator; readonly admin: AdminAuthenticator };
  /** Kiểm quyền mọi route `/admin/*` (ADR-0022) — do module apps hiện thực. */
  readonly adminAuthorizer: AdminAuthorizer;
  /** Việc quản trị KHÔNG có route HTTP — chỉ `entrypoints/admin-cli` gọi (tạo admin đầu tiên). */
  readonly adminOps: AdminOps & { grantAppRole: GrantAppRole };
}

/**
 * DANH SÁCH MODULE — thêm module mới là thêm MỘT dòng ở đây (và một file trong `modules/`).
 * Thứ tự dựng theo phụ thuộc: settings -> tenancy -> apps (cần findOrganization, settings); subscriptions -> directory
 * (directory đặt email qua use case của subscriptions) -> topics (cần apps, directory, subscriptions)
 * -> templates (cần apps) -> delivery (provider email) -> notifications (cần directory, subscriptions, topics, templates, delivery)
 * -> webhooks (cần notifications, settings) -> incoming (cần apps, templates, topics, notifications, settings).
 */
export interface ApplicationOverrides {
  /** Test thay provider email để kịch bản hoá kết quả gửi (MockEmailProvider.respondWith). */
  emailProvider?: EmailProvider | undefined;
  /** Test thay nhà cung cấp AI bằng bản giả — không gọi ra ngoài. */
  templateAiWriter?: TemplateAiWriter | undefined;
  /** Test thay đăng nhập Microsoft bằng bản trỏ vào Microsoft giả. */
  microsoftIdentity?: MicrosoftIdentity | undefined;
  /** Test thay danh bạ M365 bằng bản giả — không gọi Graph (ADR-0027). */
  tenantDirectory?: TenantDirectory | undefined;
  /** Test thay phần gọi HTTPS ra URL của app bằng bản ghi lại — không gọi mạng (ADR-0029). */
  webhookTransport?: WebhookTransport | undefined;
}

export function buildApplication(container: Container, overrides: ApplicationOverrides = {}): Application {
  const settings = settingsModule(container);
  const tenancy = tenancyModule(container, {
    microsoftIdentity: overrides.microsoftIdentity,
    tenantDirectory: overrides.tenantDirectory,
  });
  const apps = appsModule(container, {
    findOrganization: tenancy.findOrganization,
    findOrgMemberships: tenancy.findOrgMemberships,
    removeOrgMember: tenancy.removeOrgMember,
    systemSettings: settings.systemSettings,
  });
  const subscriptions = subscriptionsModule(container);
  const directory = directoryModule(container, subscriptions);
  const topics = topicsModule(container, {
    appQueries: apps.appQueries,
    findUser: directory.findUser,
    setOptedOutOptional: subscriptions.setOptedOutOptional,
  });
  const templates = templatesModule(container, { appQueries: apps.appQueries, aiWriter: overrides.templateAiWriter });
  const delivery = deliveryModule(container, overrides);
  const notifications = notificationsModule(container, {
    findUser: directory.findUser,
    findUserEmail: subscriptions.findUserEmail,
    consentQueries: topics.consentQueries,
    sendEmail: delivery.sendEmail,
    sendRateLimiter: delivery.sendRateLimiter,
    renderTemplate: templates.renderTemplate,
    templateQueries: templates.templateQueries,
  });
  const webhooks = webhooksModule(container, {
    notificationOutcomes: notifications.notificationOutcomes,
    systemSettings: settings.systemSettings,
    transport: overrides.webhookTransport,
  });
  const incoming = incomingModule(container, {
    authorizeAppIngress: apps.authorizeAppIngress,
    templateQueries: templates.templateQueries,
    renderTemplate: templates.renderTemplate,
    consentQueries: topics.consentQueries,
    publishToTopic: notifications.publishToTopic,
    systemSettings: settings.systemSettings,
  });
  const audit = auditModule(container);

  return {
    modules: [
      tenancy.definition,
      apps.definition,
      subscriptions.definition,
      directory.definition,
      topics.definition,
      templates.definition,
      delivery.definition,
      notifications.definition,
      webhooks,
      settings.definition,
      incoming,
      audit,
    ],
    authenticators: {
      apiKey: apps.apiKeyAuthenticator,
      admin: tenancy.adminAuthenticator,
    },
    adminAuthorizer: apps.adminAuthorizer,
    adminOps: { ...tenancy.adminOps, grantAppRole: apps.grantAppRole },
  };
}

/** Route của mọi module, gộp theo bề mặt — process api đọc hàm này. */
export function httpSurfaces(application: Application): Record<keyof HttpSurfaces, HttpRoutes[]> {
  const pick = (surface: keyof HttpSurfaces) => application.modules.flatMap((m) => m.http?.[surface] ?? []);
  return { public: pick('public'), admin: pick('admin'), v1: pick('v1') };
}

/** Consumer của mọi module — process worker đọc hàm này. */
export function consumerRegistry(application: Application): ConsumerRegistration[] {
  return application.modules.flatMap((m) => m.consumers ?? []);
}

/** Job nghiệp vụ của mọi module — process scheduler đọc hàm này (cộng với job hạ tầng). */
export function moduleJobs(application: Application): Job[] {
  return application.modules.flatMap((m) => m.jobs ?? []);
}
