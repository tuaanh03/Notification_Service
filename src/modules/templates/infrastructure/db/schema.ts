import { sql } from 'drizzle-orm';
import { boolean, int, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { CHANNELS, TEMPLATE_STATUSES, TEMPLATE_VERSION_STATUSES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import type { VariableSpec } from '../../domain/template-variables.ts';

export const templates = mysqlTable(
  'templates',
  {
    templateId: uuidPk('template_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    key: varchar('key', { length: 128 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    channel: mysqlEnum('channel', CHANNELS).notNull(),
    status: mysqlEnum('status', TEMPLATE_STATUSES).notNull().default('active'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [uniqueIndex('uq_templates_app_key').on(t.appId, t.key)],
);

export const templateVersions = mysqlTable(
  'template_versions',
  {
    templateVersionId: uuidPk('template_version_id'),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.templateId),
    version: int('version').notNull(),
    status: mysqlEnum('status', TEMPLATE_VERSION_STATUSES).notNull().default('draft'),
    subject: varchar('subject', { length: 500 }).notNull(),
    html: text('html').notNull(),
    text: text('text').notNull(),
    /** Khai nguồn từng biến: payload | user, required, để publish kiểm tra được. */
    schema: json('schema').$type<VariableSpec[]>().notNull().default([]),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    publishedAt: ts('published_at'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),

    /**
     * MySQL không có partial unique index (`UNIQUE ... WHERE status='published'`).
     * Cách thay thế: generated column bằng 1 khi published, NULL khi không —
     * unique index coi các NULL là khác nhau, nên nhiều draft cùng tồn tại
     * mà vẫn chỉ có đúng một published cho mỗi template.
     */
    publishedMarker: int('published_marker').generatedAlwaysAs(
      sql`(case when \`status\` = 'published' then 1 else null end)`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    uniqueIndex('uq_template_versions_template_version').on(t.templateId, t.version),
    uniqueIndex('uq_template_versions_one_published').on(t.templateId, t.publishedMarker),
  ],
);
