import { boolean, json, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { PREFERENCE_SOURCES, TOPIC_DEFAULT_MODES, TOPIC_STATUSES } from '../../../../shared/kernel/enums.ts';
import { tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import { users } from '../../../directory/infrastructure/db/schema.ts';

/** Topic = kho CONSENT: "user muốn nhận gì". Scope theo app. */
export const topics = mysqlTable(
  'topics',
  {
    topicId: uuidPk('topic_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    key: varchar('key', { length: 128 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    status: mysqlEnum('status', TOPIC_STATUSES).notNull().default('draft'),
    defaultMode: mysqlEnum('default_mode', TOPIC_DEFAULT_MODES).notNull().default('opt_out'),
    /** Topic thiết yếu: bỏ qua lớp preference, KHÔNG bỏ qua lớp kênh chết. */
    mandatory: boolean('mandatory').notNull().default(false),
    defaultChannels: json('default_channels').$type<string[]>().notNull().default([]),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [uniqueIndex('uq_topics_app_key').on(t.appId, t.key)],
);

/** Không có dòng = dùng default_mode của topic. */
export const userTopicPreferences = mysqlTable(
  'user_topic_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.topicId, { onDelete: 'cascade' }),
    optedIn: boolean('opted_in').notNull(),
    source: mysqlEnum('source', PREFERENCE_SOURCES).notNull(),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topicId] })],
);
