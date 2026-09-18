import { bigint, index, json, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';
import { ts, tsNow, uuid } from './columns.ts';

/**
 * Bảng hạ tầng dùng chung — không thuộc module nghiệp vụ nào.
 */

/**
 * Outbox: command ghi event vào đây TRONG CÙNG TRANSACTION với thay đổi nghiệp vụ,
 * scheduler relay sang Redis Stream sau. Không bao giờ XADD thẳng trong transaction HTTP
 * — nếu không sẽ có cảnh "commit DB xong nhưng XADD fail" hoặc ngược lại.
 */
export const outbox = mysqlTable(
  'outbox',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: varchar('event_type', { length: 96 }).notNull(),
    stream: varchar('stream', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    createdAt: tsNow('created_at'),
    publishedAt: ts('published_at'),
  },
  (t) => [
    // Relay quét đúng hàng chưa publish: SELECT ... FOR UPDATE SKIP LOCKED (MySQL 8.0+).
    index('idx_outbox_unpublished').on(t.publishedAt, t.id),
  ],
);

/**
 * Chốt idempotent cho consumer: INSERT trước khi xử lý, trùng khoá -> bỏ qua.
 * Redis Streams là at-least-once nên một message CHẮC CHẮN sẽ tới hai lần vào lúc nào đó.
 */
export const processedMessages = mysqlTable(
  'processed_messages',
  {
    consumerGroup: varchar('consumer_group', { length: 64 }).notNull(),
    messageId: varchar('message_id', { length: 64 }).notNull(),
    at: tsNow('at'),
  },
  // PRIMARY KEY, không phải index: idempotency dựa vào việc INSERT trùng bị TỪ CHỐI.
  // Index thường vẫn cho chèn trùng -> consumer sẽ xử lý hai lần.
  (t) => [primaryKey({ columns: [t.consumerGroup, t.messageId] })],
);
