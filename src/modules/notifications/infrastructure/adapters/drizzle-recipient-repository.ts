import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
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
type UpdateResult = [{ affectedRows: number }, unknown];

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

  async findByNotifications(notificationIds: readonly NotificationIdType[]): Promise<Map<NotificationIdType, NotificationRecipient>> {
    if (notificationIds.length === 0) return new Map();
    const rows = await this.transactions
      .executor()
      .select()
      .from(notificationRecipients)
      .where(inArray(notificationRecipients.notificationId, [...notificationIds]));
    // Gửi trực tiếp: một notification một dòng — cùng giả định với `findByNotification`.
    return new Map(rows.map((row) => [NotificationId.parse(row.notificationId), toRecipient(row)] as const));
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
      openTracked: r.openTracked,
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

  async recordOpen(notificationId: NotificationIdType, at: Date): Promise<'first' | 'again' | null> {
    const db = this.transactions.require('RecipientRepository.recordOpen');
    const target = and(
      eq(notificationRecipients.notificationId, notificationId),
      eq(notificationRecipients.channel, 'email'),
      eq(notificationRecipients.status, 'sent'),
    );
    // Lần đầu = UPDATE có điều kiện `first_opened_at IS NULL`: hai lượt mở cùng lúc thì dòng bị khoá, chỉ
    // một lượt khớp điều kiện — chỉ một "lần đầu", chỉ một sự kiện webhook.
    const [first] = (await db
      .update(notificationRecipients)
      .set({ openCount: sql`${notificationRecipients.openCount} + 1`, firstOpenedAt: at })
      .where(and(target, isNull(notificationRecipients.firstOpenedAt)))) as unknown as UpdateResult;
    if (first.affectedRows > 0) return 'first';
    const [again] = (await db
      .update(notificationRecipients)
      .set({ openCount: sql`${notificationRecipients.openCount} + 1` })
      .where(target)) as unknown as UpdateResult;
    return again.affectedRows > 0 ? 'again' : null;
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
    openTracked: row.openTracked,
    firstOpenedAt: row.firstOpenedAt,
    openCount: row.openCount,
  });
}
