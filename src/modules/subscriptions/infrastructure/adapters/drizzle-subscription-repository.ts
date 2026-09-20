import { and, eq, inArray } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import { AppId, SubscriptionId, UserId, type AppId as AppIdType, type Channel, type UserId as UserIdType } from '../../../../shared/kernel/index.ts';
import { emailTaken } from '../../application/commands/set-user-email.ts';
import type { SubscriptionRepository } from '../../application/ports/index.ts';
import { Subscription } from '../../domain/entities/subscription.ts';
import { subscriptions } from '../db/schema.ts';

type Row = typeof subscriptions.$inferSelect;

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findByUser(appId: AppIdType, userId: UserIdType, channel: Channel): Promise<Subscription | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.appId, appId), eq(subscriptions.userId, userId), eq(subscriptions.channel, channel)))
      .limit(1);
    return row ? toSubscription(row) : null;
  }

  async findManyByUsers(appId: AppIdType, userIds: readonly UserIdType[], channel: Channel): Promise<Subscription[]> {
    if (userIds.length === 0) return [];
    const rows = await this.transactions
      .executor()
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.appId, appId), eq(subscriptions.channel, channel), inArray(subscriptions.userId, [...userIds])),
      );
    return rows.map(toSubscription);
  }

  async findByValue(appId: AppIdType, channel: Channel, value: string): Promise<Subscription | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.appId, appId), eq(subscriptions.channel, channel), eq(subscriptions.value, value)));
    return row ? toSubscription(row) : null;
  }

  async insert(sub: Subscription): Promise<void> {
    await this.write(() =>
      this.transactions
        .executor()
        .insert(subscriptions)
        .values({ subscriptionId: sub.id, userId: sub.userId, appId: sub.appId, channel: sub.channel, ...state(sub), createdAt: sub.createdAt }),
    );
  }

  async update(sub: Subscription): Promise<void> {
    await this.write(() =>
      this.transactions.executor().update(subscriptions).set(state(sub)).where(eq(subscriptions.subscriptionId, sub.id)),
    );
  }

  /** Hai request cùng giành một địa chỉ: unique index quyết định, đổi thành lỗi nghiệp vụ. */
  private async write(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_subscriptions_app_channel_value') throw emailTaken();
      throw err;
    }
  }
}

function state(sub: Subscription) {
  return {
    value: sub.value,
    status: sub.status,
    optedOutOptional: sub.optedOutOptional,
    optedOutOptionalAt: sub.optedOutOptionalAt,
    suppressedReason: sub.suppressedReason,
    suppressedAt: sub.suppressedAt,
    manageToken: sub.manageToken,
    manageTokenRotatedAt: sub.manageTokenRotatedAt,
    updatedAt: sub.updatedAt,
  };
}

function toSubscription(row: Row): Subscription {
  return new Subscription({
    id: SubscriptionId.parse(row.subscriptionId),
    userId: UserId.parse(row.userId),
    appId: AppId.parse(row.appId),
    channel: row.channel,
    value: row.value,
    status: row.status,
    optedOutOptional: row.optedOutOptional,
    optedOutOptionalAt: row.optedOutOptionalAt,
    suppressedReason: row.suppressedReason,
    suppressedAt: row.suppressedAt,
    manageToken: row.manageToken,
    manageTokenRotatedAt: row.manageTokenRotatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
