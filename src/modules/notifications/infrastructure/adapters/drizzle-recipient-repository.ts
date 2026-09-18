import { and, eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import {
  NotificationId,
  SegmentId,
  SubscriptionId,
  UserId,
  type NotificationId as NotificationIdType,
} from '../../../../shared/kernel/index.ts';
import type { RecipientRepository } from '../../application/ports/index.ts';
import { NotificationRecipient } from '../../domain/entities/notification-recipient.ts';
import { notificationRecipients } from '../db/schema.ts';

type Row = typeof notificationRecipients.$inferSelect;

export class DrizzleRecipientRepository implements RecipientRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findByNotification(notificationId: NotificationIdType): Promise<NotificationRecipient | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(notificationRecipients)
      .where(eq(notificationRecipients.notificationId, notificationId))
      .limit(1);
    return row ? toRecipient(row) : null;
  }

  async insert(r: NotificationRecipient): Promise<void> {
    await this.transactions.executor().insert(notificationRecipients).values({
      notificationId: r.notificationId,
      userId: r.userId,
      channel: r.channel,
      personId: r.personId,
      subscriptionId: r.subscriptionId,
      address: r.address,
      includedVia: r.includedVia,
      exclusionReason: r.exclusionReason,
      batchNo: r.batchNo,
      status: r.status,
      providerMessageId: r.providerMessageId,
      error: r.error,
      sentAt: r.sentAt,
    });
  }

  async update(r: NotificationRecipient): Promise<void> {
    await this.transactions
      .executor()
      .update(notificationRecipients)
      .set({ status: r.status, providerMessageId: r.providerMessageId, error: r.error, sentAt: r.sentAt })
      .where(
        and(
          eq(notificationRecipients.notificationId, r.notificationId),
          eq(notificationRecipients.userId, r.userId),
          eq(notificationRecipients.channel, r.channel),
        ),
      );
  }
}

function toRecipient(row: Row): NotificationRecipient {
  const via = row.includedVia;
  return new NotificationRecipient({
    notificationId: NotificationId.parse(row.notificationId),
    userId: UserId.parse(row.userId),
    subscriptionId: row.subscriptionId === null ? null : SubscriptionId.parse(row.subscriptionId),
    channel: row.channel,
    address: row.address,
    includedVia: via === null || via === 'direct' || via === 'all_users' ? via : SegmentId.parse(via),
    exclusionReason: row.exclusionReason,
    batchNo: row.batchNo,
    status: row.status,
    providerMessageId: row.providerMessageId,
    error: row.error,
    sentAt: row.sentAt,
  });
}
