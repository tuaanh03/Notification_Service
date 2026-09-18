import { boolean, index, int, json, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import {
  ACTOR_TYPES,
  CHANNELS,
  EXCLUSION_REASONS,
  NOTIFICATION_ORIGINS,
  NOTIFICATION_STATUSES,
  RECIPIENT_STATUSES,
} from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import { topics } from '../../../topics/infrastructure/db/schema.ts';
import { templateVersions } from '../../../templates/infrastructure/db/schema.ts';
import { users } from '../../../directory/infrastructure/db/schema.ts';
import type { Counters } from '../../domain/types/counters.ts';

/** Một dòng = một lần gửi, bất kể đến từ API hay người soạn. */
export const notifications = mysqlTable(
  'notifications',
  {
    notificationId: uuidPk('notification_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.topicId),
    origin: mysqlEnum('origin', NOTIFICATION_ORIGINS).notNull(),
    status: mysqlEnum('status', NOTIFICATION_STATUSES).notNull(),
    isTest: boolean('is_test').notNull().default(false),
    templateVersionId: uuid('template_version_id').references(
      () => templateVersions.templateVersionId,
    ),
    /** Dữ liệu của MỘT lần gửi. Giới hạn 2 KB ép ở domain (413 nếu vượt). */
    payload: json('payload').$type<Record<string, unknown>>().notNull().default({}),
    includedSegments: json('included_segments').$type<string[]>().notNull().default([]),
    excludedSegments: json('excluded_segments').$type<string[]>().notNull().default([]),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    collapseKey: varchar('collapse_key', { length: 255 }),
    occurrenceCount: int('occurrence_count').notNull().default(1),
    staleDirectory: boolean('stale_directory').notNull().default(false),
    parentNotificationId: uuid('parent_notification_id'),
    scheduledAt: ts('scheduled_at'),
    createdBy: varchar('created_by', { length: 64 }),
    approvedBy: varchar('approved_by', { length: 64 }),
    previewRenderedAt: ts('preview_rendered_at'),
    counters: json('counters').$type<Counters>().notNull(),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
    queuedAt: ts('queued_at'),
    sendingAt: ts('sending_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    /**
     * MySQL coi mỗi NULL trong unique index là một giá trị khác nhau, nên index này
     * hành xử ĐÚNG như partial index `WHERE idempotency_key IS NOT NULL` của Postgres:
     * chặn trùng khi có key, không cản gì khi key NULL. Đây là chốt cuối của idempotency.
     */
    uniqueIndex('uq_notifications_app_idempotency').on(t.appId, t.idempotencyKey),
    index('idx_notifications_app_created').on(t.appId, t.createdAt),
    // MySQL không có partial index -> index thường, query phải kèm status='scheduled'.
    index('idx_notifications_scheduled').on(t.status, t.scheduledAt),
  ],
);

/**
 * Nguồn của LifecycleTimeline và AuditTrail. Ghi TRONG CÙNG TRANSACTION với lần
 * UPDATE trạng thái (SM-9) — audit không thể thiếu, không phải ghi "best effort".
 *
 * `from` / `to` là từ khoá của MySQL nên cột đặt tên from_status / to_status.
 */
export const notificationTransitions = mysqlTable(
  'notification_transitions',
  {
    transitionId: uuidPk('transition_id'),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.notificationId),
    fromStatus: mysqlEnum('from_status', NOTIFICATION_STATUSES).notNull(),
    toStatus: mysqlEnum('to_status', NOTIFICATION_STATUSES).notNull(),
    event: varchar('event', { length: 64 }).notNull(),
    actor: varchar('actor', { length: 64 }).notNull(),
    actorType: mysqlEnum('actor_type', ACTOR_TYPES).notNull(),
    reason: varchar('reason', { length: 500 }),
    at: tsNow('at'),
  },
  (t) => [index('idx_notification_transitions_notification').on(t.notificationId, t.at)],
);

/**
 * Snapshot người nhận, chốt tại lối vào `queued`.
 *
 * CHƯA partition. MySQL bắt buộc mọi khoá unique phải chứa cột partition, nên partition
 * theo tháng sẽ buộc phải nhét created_month vào PK — quyết định đó để lại cho ADR
 * về retention, không làm lén ở phase 0.
 */
export const notificationRecipients = mysqlTable(
  'notification_recipients',
  {
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.notificationId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.userId),
    channel: mysqlEnum('channel', CHANNELS).notNull(),
    personId: uuid('person_id'),
    subscriptionId: uuid('subscription_id'),
    address: varchar('address', { length: 512 }).notNull(),
    includedVia: varchar('included_via', { length: 64 }),
    /** Vì sao người này KHÔNG nhận được — câu trả lời cho "tại sao thư không tới". */
    exclusionReason: mysqlEnum('exclusion_reason', EXCLUSION_REASONS),
    batchNo: int('batch_no'),
    status: mysqlEnum('status', RECIPIENT_STATUSES).notNull().default('pending'),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    error: varchar('error', { length: 500 }),
    sentAt: ts('sent_at'),
    createdAt: tsNow('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.notificationId, t.userId, t.channel] }),
    index('idx_notification_recipients_subscription').on(t.subscriptionId),
    index('idx_notification_recipients_batch').on(t.notificationId, t.batchNo),
  ],
);

export const sendApprovals = mysqlTable(
  'send_approvals',
  {
    approvalId: uuidPk('approval_id'),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.notificationId),
    estimate: int('estimate').notNull(),
    author: varchar('author', { length: 64 }).notNull(),
    reviewer: varchar('reviewer', { length: 64 }),
    status: mysqlEnum('status', ['pending', 'approved', 'rejected']).notNull().default('pending'),
    reason: varchar('reason', { length: 500 }),
    decidedAt: ts('decided_at'),
    createdAt: tsNow('created_at'),
  },
  (t) => [index('idx_send_approvals_notification').on(t.notificationId)],
);
