import { boolean, index, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { CHANNELS, SUBSCRIPTION_STATUSES, SUPPRESSED_REASONS } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
import { apps } from '../../../apps/infrastructure/db/schema.ts';
import { users } from '../../../directory/infrastructure/db/schema.ts';

/**
 * Subscription = kho COMPLIANCE: "kênh còn bật không".
 *
 * Hai khái niệm tách hẳn nhau, cố tình không gộp vào một cờ:
 *   status = 'unsubscribed' | 'invalid'  -> kênh chết, chặn MỌI tin kể cả mandatory
 *   opted_out_optional = true            -> chỉ chặn tin KHÔNG bắt buộc
 * Gộp hai cái này chính là nguyên nhân khiến tin mandatory bị chặn oan.
 */
export const subscriptions = mysqlTable(
  'subscriptions',
  {
    subscriptionId: uuidPk('subscription_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.appId),
    channel: mysqlEnum('channel', CHANNELS).notNull(),
    /** email / số điện thoại / push token. */
    value: varchar('value', { length: 512 }).notNull(),
    status: mysqlEnum('status', SUBSCRIPTION_STATUSES).notNull().default('active'),
    optedOutOptional: boolean('opted_out_optional').notNull().default(false),
    optedOutOptionalAt: ts('opted_out_optional_at'),
    /** Phân biệt "user tự tắt" (bật lại được) với "hard bounce" (app service không được tự bật). */
    suppressedReason: mysqlEnum('suppressed_reason', SUPPRESSED_REASONS),
    suppressedAt: ts('suppressed_at'),
    /** Token trong link "Quản lý thông báo" — không lộ user_id/person_id ra ngoài. */
    manageToken: uuid('manage_token').notNull(),
    manageTokenRotatedAt: tsNow('manage_token_rotated_at'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    // Một địa chỉ/thiết bị tồn tại đúng một lần trong một app.
    uniqueIndex('uq_subscriptions_app_channel_value').on(t.appId, t.channel, t.value),
    uniqueIndex('uq_subscriptions_manage_token').on(t.manageToken),
    index('idx_subscriptions_user').on(t.userId),
    index('idx_subscriptions_app_status').on(t.appId, t.status),
  ],
);
