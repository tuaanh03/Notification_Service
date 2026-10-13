import { foreignKey, index, int, json, mysqlEnum, mysqlTable, text, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { WEBHOOK_DELIVERY_STATUSES, WEBHOOK_ENDPOINT_STATUSES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';

/** Một URL của app nhận outgoing webhook (ADR-0029). KHÔNG có cột secret — secret tính lại từ khoá chủ. */
export const webhookEndpoints = mysqlTable(
  'webhook_endpoints',
  {
    endpointId: uuidPk('endpoint_id'),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    /** 1…N — unique theo app là chốt "tối đa N URL" khi hai lệnh thêm chạy song song. */
    slot: tinyint('slot').notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    events: json('events').$type<string[]>().notNull(),
    secretVersion: int('secret_version').notNull().default(1),
    status: mysqlEnum('status', WEBHOOK_ENDPOINT_STATUSES).notNull().default('active'),
    createdBy: varchar('created_by', { length: 64 }),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [uniqueIndex('uq_webhook_endpoints_app_slot').on(t.appId, t.slot)],
);

/** Một lượt EWS phải báo một sự kiện cho một URL — kiêm nhật ký gọi trên console. */
export const webhookDeliveries = mysqlTable(
  'webhook_deliveries',
  {
    deliveryId: uuidPk('delivery_id'),
    endpointId: uuid('endpoint_id').notNull(),
    appId: uuid('app_id').notNull(),
    eventId: varchar('event_id', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    /** Body chốt sẵn — mọi lần gọi lại gửi đúng chuỗi này. */
    body: text('body').notNull(),
    status: mysqlEnum('status', WEBHOOK_DELIVERY_STATUSES).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    /** Lần gọi kế tiếp; khi đã nhận việc thì là hạn giữ việc. NULL khi đã xong. */
    nextAttemptAt: ts('next_attempt_at'),
    lastStatusCode: int('last_status_code'),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [
    foreignKey({ name: 'fk_webhook_deliveries_endpoint', columns: [t.endpointId], foreignColumns: [webhookEndpoints.endpointId] }),
    foreignKey({ name: 'fk_webhook_deliveries_app', columns: [t.appId], foreignColumns: [apps.appId] }),
    // Một sự kiện không thành hai lượt cho cùng một URL.
    uniqueIndex('uq_webhook_deliveries_endpoint_event').on(t.endpointId, t.eventId),
    // Job mỗi 5 giây: WHERE status = 'pending' AND next_attempt_at <= ? — thiếu index là quét cả bảng.
    index('idx_webhook_deliveries_due').on(t.status, t.nextAttemptAt),
    // Nhật ký gọi gần nhất của một URL.
    index('idx_webhook_deliveries_endpoint_created').on(t.endpointId, t.createdAt),
  ],
);
