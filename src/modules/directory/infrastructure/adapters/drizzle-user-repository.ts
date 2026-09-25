import { and, count, desc, eq, inArray, like } from 'drizzle-orm';
import { duplicateKeyName, lockParentRow, type TransactionContext } from '../../../../shared/db/index.ts';
import { AppId, OrgId, PersonId, UserId, type AppId as AppIdType, type UserId as UserIdType } from '../../../../shared/kernel/index.ts';
import { UserAlreadyExistsError } from '../../application/errors.ts';
import type { UserPage, UserRepository } from '../../application/ports/index.ts';
import { User } from '../../domain/entities/user.ts';
import { users } from '../db/schema.ts';

export class DrizzleUserRepository implements UserRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findByExternalId(appId: AppIdType, externalId: string): Promise<User | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(users)
      .where(and(eq(users.appId, appId), eq(users.externalId, externalId)));
    return row ? toUser(row) : null;
  }

  async listByApp(appId: AppIdType, page: { limit: number; offset: number; search?: string | undefined }): Promise<UserPage> {
    const search = page.search?.trim();
    // `like` trên external_id: đủ cho màn tra cứu một người. Không dựng full-text cho MVP.
    const where = search
      ? and(eq(users.appId, appId), like(users.externalId, `%${search}%`))
      : eq(users.appId, appId);
    const executor = this.transactions.executor();
    const [rows, [totals]] = await Promise.all([
      executor.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(page.limit).offset(page.offset),
      executor.select({ value: count() }).from(users).where(where),
    ]);
    return { rows: rows.map(toUser), total: totals?.value ?? 0 };
  }

  async countByApp(appId: AppIdType): Promise<number> {
    const [totals] = await this.transactions.executor().select({ value: count() }).from(users).where(eq(users.appId, appId));
    return totals?.value ?? 0;
  }

  async findManyByIds(appId: AppIdType, ids: readonly UserIdType[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const rows = await this.transactions
      .executor()
      .select()
      .from(users)
      .where(and(eq(users.appId, appId), inArray(users.userId, [...ids])));
    return rows.map(toUser);
  }

  async insert(user: User): Promise<void> {
    try {
      await this.transactions.executor().insert(users).values({
        userId: user.id,
        appId: user.appId,
        orgId: user.orgId,
        externalId: user.externalId,
        personId: user.personId,
        source: user.source,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_users_app_external') throw new UserAlreadyExistsError(user.externalId ?? '');
      throw err;
    }
  }

  lockForUpdate(id: UserIdType): Promise<boolean> {
    return lockParentRow(this.transactions.require('UserRepository.lockForUpdate'), users, users.userId, id);
  }
}

/** Dòng bảng `users` -> entity. Một nơi duy nhất, dùng cho cả tra một người và liệt kê. */
function toUser(row: typeof users.$inferSelect): User {
  return new User({
    id: UserId.parse(row.userId),
    appId: AppId.parse(row.appId),
    orgId: OrgId.parse(row.orgId),
    externalId: row.externalId,
    personId: row.personId === null ? null : PersonId.parse(row.personId),
    source: row.source,
    lastSeen: row.lastSeen,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
