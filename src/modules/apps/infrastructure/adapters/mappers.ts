import {
  AccountId,
  AppId,
  AppSecretId,
  CHANNELS,
  OrgId,
  type Channel,
} from '../../../../shared/kernel/index.ts';
import { App } from '../../domain/entities/app.ts';
import { AppNetworkRule } from '../../domain/entities/app-network-rule.ts';
import { AppSecret } from '../../domain/entities/app-secret.ts';
import type { appNetworkRules, apps, appSecrets } from '../db/schema.ts';

/**
 * Entity <-> dòng bảng. Nơi DUY NHẤT hai hình dạng này gặp nhau: domain không biết cột, bảng không
 * biết invariant. Id từ DB đi qua `XxxId.parse` — không `as`, để dữ liệu hỏng lộ ra ngay tại đây.
 */
type AppRow = typeof apps.$inferSelect;
type AppSecretRow = typeof appSecrets.$inferSelect;
type NetworkRuleRow = typeof appNetworkRules.$inferSelect;

const KNOWN_CHANNELS = new Set<string>(CHANNELS);

export function toApp(row: AppRow): App {
  return new App({
    id: AppId.parse(row.appId),
    orgId: OrgId.parse(row.orgId),
    accountId: AccountId.parse(row.accountId),
    slug: row.slug,
    name: row.name,
    namespace: row.namespace,
    status: row.status,
    origin: row.origin,
    // Cột JSON không có ràng buộc kiểu ở DB: lọc bỏ giá trị lạ thay vì tin mù.
    grantedChannels: row.grantedChannels.filter((c): c is Channel => KNOWN_CHANNELS.has(c)),
    rateLimitPerMinute: row.rateLimitPerMinute,
    maxRecipientsPerEvent: row.maxRecipientsPerEvent,
    includedInOrgBroadcast: row.includedInOrgBroadcast,
    isSystem: row.isSystem,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function fromApp(app: App): typeof apps.$inferInsert {
  return {
    appId: app.id,
    orgId: app.orgId,
    accountId: app.accountId,
    slug: app.slug,
    name: app.name,
    namespace: app.namespace,
    status: app.status,
    origin: app.origin,
    grantedChannels: [...app.grantedChannels],
    rateLimitPerMinute: app.rateLimitPerMinute,
    maxRecipientsPerEvent: app.maxRecipientsPerEvent,
    includedInOrgBroadcast: app.includedInOrgBroadcast,
    isSystem: app.isSystem,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

export function toAppSecret(row: AppSecretRow): AppSecret {
  return new AppSecret({
    id: AppSecretId.parse(row.appSecretId),
    appId: AppId.parse(row.appId),
    secretHash: row.secretHash,
    hint: row.hint,
    status: row.status,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  });
}

export function toNetworkRule(row: NetworkRuleRow): AppNetworkRule {
  return new AppNetworkRule({ appId: AppId.parse(row.appId), kind: row.kind, value: row.value });
}
