import { boolean, int, json, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { APP_ORIGINS, APP_SECRET_STATUSES, APP_STATUSES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { organizations } from '../../../tenancy/infrastructure/db/schema.ts';

/**
 * App = ranh giới cô lập messaging.
 * MySQL không có kiểu mảng -> granted_channels lưu JSON array thay cho text[].
 */
export const apps = mysqlTable(
  'apps',
  {
    appId: uuidPk('app_id'),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.orgId),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    namespace: varchar('namespace', { length: 120 }).notNull(),
    status: mysqlEnum('status', APP_STATUSES).notNull().default('draft'),
    origin: mysqlEnum('origin', APP_ORIGINS).notNull().default('internal'),
    grantedChannels: json('granted_channels').$type<string[]>().notNull().default([]),
    rateLimitPerMinute: int('rate_limit_per_minute').notNull().default(60),
    maxRecipientsPerEvent: int('max_recipients_per_event').notNull().default(1000),
    /** Org admin chủ động chọn app nào tham gia broadcast toàn org. */
    includedInOrgBroadcast: boolean('included_in_org_broadcast').notNull().default(true),
    /** App SYS: chạm mọi user trong org, chỉ Super Admin thấy. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_apps_org_slug').on(t.orgId, t.slug),
    uniqueIndex('uq_apps_org_namespace').on(t.orgId, t.namespace),
    // BẮT BUỘC: đích của composite FK (app_id, org_id) trên bảng users.
    // Bỏ dòng này thì FK không tạo được, và bỏ FK thì mất lớp chống rò rỉ chéo org.
    uniqueIndex('uq_apps_app_org').on(t.appId, t.orgId),
  ],
);

export const appSecrets = mysqlTable(
  'app_secrets',
  {
    appSecretId: uuidPk('app_secret_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    /** argon2 hash. Plaintext chỉ trả về đúng một lần, không bao giờ lưu. */
    secretHash: varchar('secret_hash', { length: 255 }).notNull(),
    hint: varchar('hint', { length: 64 }).notNull(),
    status: mysqlEnum('status', APP_SECRET_STATUSES).notNull().default('active'),
    createdAt: tsNow('created_at'),
    rotatedAt: ts('rotated_at'),
    revokedAt: ts('revoked_at'),
  },
  // "≤ 2 secret active" KHÔNG ép được ở MySQL (không có partial unique index).
  // Command phải đếm trong cùng transaction — xem AppSecret.assertCanAddActive.
  (t) => [uniqueIndex('uq_app_secrets_app_hint').on(t.appId, t.hint)],
);

export const appNetworkRules = mysqlTable(
  'app_network_rules',
  {
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    kind: mysqlEnum('kind', ['ip', 'origin']).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    createdAt: tsNow('created_at'),
  },
  (t) => [primaryKey({ columns: [t.appId, t.kind, t.value] })],
);
