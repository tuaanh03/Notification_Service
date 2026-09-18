import { foreignKey, index, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { MATCHED_ON, USER_SOURCES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { organizations } from '../../../tenancy/infrastructure/db/schema.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';

/** Person = nhận diện toàn cục trong một org. */
export const persons = mysqlTable(
  'persons',
  {
    personId: uuidPk('person_id'),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.orgId),
    /** Đã chuẩn hoá (trim + lowercase, KHÔNG strip +tag). Khoá merge deterministic. */
    primaryEmail: varchar('primary_email', { length: 320 }).notNull(),
    primaryPhone: varchar('primary_phone', { length: 32 }),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    // Một người = một person trong mỗi org.
    uniqueIndex('uq_persons_org_email').on(t.orgId, t.primaryEmail),
    // BẮT BUỘC: đích của composite FK (person_id, org_id) trên bảng users.
    uniqueIndex('uq_persons_person_org').on(t.personId, t.orgId),
  ],
);

/**
 * User = bản ghi của một người TRONG MỘT APP.
 *
 * Hai composite FK dưới đây là lớp chống rò rỉ chính của mô hình B:
 * chúng khiến việc nối một user sang person/app của org khác KHÔNG THỂ xảy ra ở DB.
 *
 * CẢNH BÁO MYSQL: InnoDB cho phép FK trỏ tới index KHÔNG unique, tức là nó sẽ im lặng
 * chấp nhận một FK yếu hơn ý định. Vì vậy hai unique index đích ở `apps` và `persons`
 * phải tồn tại và không được xoá đi vì trông "thừa".
 */
export const users = mysqlTable(
  'users',
  {
    userId: uuidPk('user_id'),
    appId: uuid('app_id').notNull(),
    /** Denormalize để ép được hai composite FK bên dưới. */
    orgId: uuid('org_id').notNull(),
    externalId: varchar('external_id', { length: 255 }),
    personId: uuid('person_id'),
    source: mysqlEnum('source', USER_SOURCES).notNull().default('api'),
    lastSeen: ts('last_seen'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    // external_id chỉ unique TRONG app, không toàn cục.
    uniqueIndex('uq_users_app_external').on(t.appId, t.externalId),
    index('idx_users_app').on(t.appId),
    index('idx_users_person').on(t.personId),
    index('idx_users_org').on(t.orgId),
    foreignKey({
      name: 'fk_users_app_org',
      columns: [t.appId, t.orgId],
      foreignColumns: [apps.appId, apps.orgId],
    }),
    foreignKey({
      name: 'fk_users_person_org',
      columns: [t.personId, t.orgId],
      foreignColumns: [persons.personId, persons.orgId],
    }),
  ],
);

/** Alias của app service để trỏ tới user bằng khoá của chính họ. */
export const userAliases = mysqlTable(
  'user_aliases',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    label: varchar('label', { length: 64 }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    createdAt: tsNow('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.label] }),
    uniqueIndex('uq_user_aliases_app_label_value').on(t.appId, t.label, t.value),
  ],
);

/** Data Tag — targeting và cá nhân hoá. KHÔNG phải quyền, KHÔNG phải consent. */
export const userTags = mysqlTable(
  'user_tags',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    key: varchar('key', { length: 128 }).notNull(),
    value: varchar('value', { length: 512 }).notNull(),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** Audit mọi lần gắn user vào person — để "unwind" được khi gộp nhầm. */
export const personMergeLog = mysqlTable(
  'person_merge_log',
  {
    logId: uuidPk('log_id'),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.personId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.userId),
    matchedOn: mysqlEnum('matched_on', MATCHED_ON).notNull(),
    matchedValue: varchar('matched_value', { length: 320 }).notNull(),
    createdAt: tsNow('created_at'),
  },
  (t) => [index('idx_person_merge_log_person').on(t.personId)],
);
