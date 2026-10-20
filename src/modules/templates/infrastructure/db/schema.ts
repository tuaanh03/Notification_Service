import { sql } from 'drizzle-orm';
import { boolean, int, json, mediumtext, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { CHANNELS, TEMPLATE_CATEGORIES, TEMPLATE_EDITORS, TEMPLATE_STATUSES, TEMPLATE_VERSION_STATUSES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import type { VisualDesign } from '../../domain/types/visual-design.ts';
import type { VariableSpec } from '../../domain/types/template-variable.ts';

export const templates = mysqlTable(
  'templates',
  {
    templateId: uuidPk('template_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    /** App gửi bằng `template_id` (ADR-0020) — không có key. Tên chỉ cho người đọc, không trùng trong app. */
    name: varchar('name', { length: 200 }).notNull(),
    channel: mysqlEnum('channel', CHANNELS).notNull(),
    /** Nhóm để admin gom và lọc (ADR-0033) — bộ cố định, không ảnh hưởng việc gửi. */
    category: mysqlEnum('category', TEMPLATE_CATEGORIES).notNull().default('other'),
    status: mysqlEnum('status', TEMPLATE_STATUSES).notNull().default('active'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  /**
   * Collation `utf8mb4_0900_ai_ci`: so sánh KHÔNG phân biệt hoa thường và dấu, nên
   * "Cảnh báo VM" và "canh bao vm" là trùng — cố ý, hai tên như vậy làm admin nhầm.
   */
  (t) => [uniqueIndex('uq_templates_app_name').on(t.appId, t.name)],
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
    /**
     * Kiểu soạn (ADR-0036; `blocks` của ADR-0034 gỡ ở migration 0027 — ADR-0037). `visual`: trình duyệt sinh
     * `html`, backend kiểm rồi sinh `text`. Vẫn gửi từ cột `html` / `text`.
     */
    editor: mysqlEnum('editor', TEMPLATE_EDITORS).notNull().default('html'),
    /** `visual`: dự án GrapesJS + MJML; NULL khi `editor = 'html'`. */
    design: json('design').$type<VisualDesign>(),
    subject: varchar('subject', { length: 500 }).notNull(),
    /** MEDIUMTEXT như `notifications.body_html` — TEXT chỉ 64 KB, HTML email có style inline dễ vượt. */
    html: mediumtext('html').notNull(),
    text: mediumtext('text').notNull(),
    /** Khai nguồn từng biến: payload | user, required, để publish kiểm tra được. */
    schema: json('schema').$type<VariableSpec[]>().notNull().default([]),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    /** ID admin tạo / xuất bản bản này. NULL với dòng có trước migration 0006. */
    createdBy: varchar('created_by', { length: 64 }),
    publishedBy: varchar('published_by', { length: 64 }),
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
