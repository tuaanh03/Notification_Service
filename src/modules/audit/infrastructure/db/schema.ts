import { index, json, mysqlEnum, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { ACTOR_TYPES } from '../../../../shared/kernel/enums.ts';
import { tsNow, uuidPk } from '../../../../shared/db/columns.ts';

/**
 * Append-only. Role DB của ứng dụng chỉ được GRANT INSERT, SELECT trên bảng này —
 * không có DELETE, không có UPDATE (SM-8). Đặt quyền đó trong migration vận hành.
 *
 * `before` / `after` là từ khoá MySQL nên cột đặt tên before_data / after_data.
 */
export const auditLog = mysqlTable(
  'audit_log',
  {
    auditId: uuidPk('audit_id'),
    actor: varchar('actor', { length: 64 }).notNull(),
    actorType: mysqlEnum('actor_type', ACTOR_TYPES).notNull(),
    action: varchar('action', { length: 96 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 64 }).notNull(),
    beforeData: json('before_data').$type<Record<string, unknown>>(),
    afterData: json('after_data').$type<Record<string, unknown>>(),
    source: varchar('source', { length: 64 }).notNull(),
    at: tsNow('at'),
  },
  (t) => [
    index('idx_audit_log_target').on(t.targetType, t.targetId, t.at),
    index('idx_audit_log_actor').on(t.actor, t.at),
  ],
);
