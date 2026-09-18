import { index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { BOUNCE_KINDS, CHANNELS, DELIVERY_BATCH_STATUSES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { notifications } from '../../../notifications/infrastructure/db/schema.ts';

export const deliveryBatches = mysqlTable(
  'delivery_batches',
  {
    deliveryBatchId: uuidPk('delivery_batch_id'),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.notificationId),
    batchNo: int('batch_no').notNull(),
    channel: mysqlEnum('channel', CHANNELS).notNull(),
    size: int('size').notNull(),
    status: mysqlEnum('status', DELIVERY_BATCH_STATUSES).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: tsNow('created_at'),
  },
  // Khoá idempotent thứ hai của delivery consumer, cạnh processed_messages.
  (t) => [uniqueIndex('uq_delivery_batches_notification_batch').on(t.notificationId, t.batchNo)],
);

export const bounceEvents = mysqlTable(
  'bounce_events',
  {
    bounceEventId: uuidPk('bounce_event_id'),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    address: varchar('address', { length: 512 }).notNull(),
    kind: mysqlEnum('kind', BOUNCE_KINDS).notNull(),
    raw: json('raw').$type<Record<string, unknown>>().notNull().default({}),
    at: tsNow('at'),
  },
  (t) => [index('idx_bounce_events_address').on(t.address)],
);
