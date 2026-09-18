import {
  BootstrapAdminAuthenticator,
  type AdminAuthenticator,
  type ApiKeyAuthenticator,
  type HttpRoutes,
  type HttpSurfaces,
} from '../shared/http/index.ts';
import type { EmailProvider } from '../modules/delivery/application/index.ts';
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
import { topicsModule } from './modules/topics.module.ts';
import { tenancyModule } from './modules/tenancy.module.ts';

/** Toàn bộ nghiệp vụ đã ghép, sẵn sàng cắm vào process. */
export interface Application {
  readonly modules: readonly ModuleDefinition[];
  readonly authenticators: { readonly apiKey: ApiKeyAuthenticator; readonly admin: AdminAuthenticator };
}

/**
 * DANH SÁCH MODULE — thêm module mới là thêm MỘT dòng ở đây (và một file trong `modules/`).
 * Thứ tự dựng theo phụ thuộc: tenancy -> apps (cần findOrganization); subscriptions -> directory
 * (directory đặt email qua use case của subscriptions) -> topics (cần apps, directory, subscriptions)
 * -> delivery (provider email) -> notifications (cần directory, subscriptions, topics, delivery).
 */
export interface ApplicationOverrides {
  /** Test thay provider email để kịch bản hoá kết quả gửi (MockEmailProvider.respondWith). */
  emailProvider?: EmailProvider | undefined;
}

export function buildApplication(container: Container, overrides: ApplicationOverrides = {}): Application {
  const tenancy = tenancyModule(container);
  const apps = appsModule(container, { findOrganization: tenancy.findOrganization });
  const subscriptions = subscriptionsModule(container);
  const directory = directoryModule(container, subscriptions);
  const topics = topicsModule(container, {
    appQueries: apps.appQueries,
    findUser: directory.findUser,
    setOptedOutOptional: subscriptions.setOptedOutOptional,
  });
  const delivery = deliveryModule(container, overrides);
  const notifications = notificationsModule(container, {
    findUser: directory.findUser,
    findUserEmail: subscriptions.findUserEmail,
    consentQueries: topics.consentQueries,
    sendEmail: delivery.sendEmail,
  });
  const audit = auditModule(container);

  return {
    modules: [
      tenancy.definition,
      apps.definition,
      subscriptions.definition,
      directory.definition,
      topics.definition,
      delivery.definition,
      notifications.definition,
      audit,
    ],
    authenticators: {
      apiKey: apps.apiKeyAuthenticator,
      admin: new BootstrapAdminAuthenticator({ token: container.env.ADMIN_TOKEN }),
    },
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
