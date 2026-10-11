import { foreignKey, index, int, json, mysqlEnum, mysqlTable, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { INCOMING_CALL_OUTCOMES, INCOMING_HOOK_STATUSES } from '../../../../shared/kernel/enums.ts';
import { tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import { publications } from '../../../notifications/infrastructure/db/schema.ts';
import { templates } from '../../../templates/infrastructure/db/schema.ts';
import { topics } from '../../../topics/infrastructure/db/schema.ts';
import type { PublishCondition, VariableMapping } from '../../domain/types/hook-config.ts';

/**
 * Một incoming webhook (ADR-0030). Token gốc KHÔNG lưu — tính lại từ khoá chủ + id + `token_version`;
 * DB chỉ có băm SHA-256 để tra lời gọi vào + đoạn gợi nhớ.
 */
export const incomingHooks = mysqlTable(
  'incoming_hooks',
  {
    hookId: uuidPk('hook_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    /** 1..10 — unique theo app là chốt "tối đa 10 hook" khi hai lệnh thêm chạy song song. */
    slot: tinyint('slot').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.topicId),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.templateId),
    mappings: json('mappings').$type<VariableMapping[]>().notNull(),
    dedupePath: varchar('dedupe_path', { length: 200 }),
    condition: json('publish_condition').$type<PublishCondition | null>(),
    /** SHA-256 hex của token. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    tokenHint: varchar('token_hint', { length: 32 }).notNull(),
    /** Token = HMAC(khoá chủ, id:phiên bản) — đổi URL = +1. */
    tokenVersion: int('token_version').notNull().default(1),
    status: mysqlEnum('status', INCOMING_HOOK_STATUSES).notNull().default('active'),
    createdBy: varchar('created_by', { length: 64 }),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_incoming_hooks_app_slot').on(t.appId, t.slot),
    // Mỗi lời gọi vào tra hook theo băm token.
    uniqueIndex('uq_incoming_hooks_token_hash').on(t.tokenHash),
  ],
);

/** Nhật ký gọi — KHÔNG có body gốc. Job dọn dòng cũ hơn 30 ngày. */
export const incomingCalls = mysqlTable(
  'incoming_calls',
  {
    callId: uuidPk('call_id'),
    hookId: uuid('hook_id').notNull(),
    appId: uuid('app_id').notNull(),
    at: tsNow('at'),
    httpStatus: int('http_status').notNull(),
    outcome: mysqlEnum('outcome', INCOMING_CALL_OUTCOMES).notNull(),
    publicationId: uuid('publication_id'),
    recipientCount: int('recipient_count'),
    errorCode: varchar('error_code', { length: 64 }),
  },
  (t) => [
    foreignKey({ name: 'fk_incoming_calls_hook', columns: [t.hookId], foreignColumns: [incomingHooks.hookId] }),
    foreignKey({ name: 'fk_incoming_calls_app', columns: [t.appId], foreignColumns: [apps.appId] }),
    foreignKey({ name: 'fk_incoming_calls_publication', columns: [t.publicationId], foreignColumns: [publications.publicationId] }),
    index('idx_incoming_calls_hook_at').on(t.hookId, t.at),
    // Job dọn: WHERE at < ?.
    index('idx_incoming_calls_at').on(t.at),
  ],
);
