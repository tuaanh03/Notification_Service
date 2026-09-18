import { and, eq } from 'drizzle-orm';
import { duplicateKeyName, lockParentRow, type TransactionContext } from '../../../../shared/db/index.ts';
import { AppId, OrgId, PersonId, UserId, type AppId as AppIdType, type UserId as UserIdType } from '../../../../shared/kernel/index.ts';
import { UserAlreadyExistsError } from '../../application/errors.ts';
import type { UserRepository } from '../../application/ports/index.ts';
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
    return row
      ? new User({
          id: UserId.parse(row.userId),
          appId: AppId.parse(row.appId),
          orgId: OrgId.parse(row.orgId),
          externalId: row.externalId,
          personId: row.personId === null ? null : PersonId.parse(row.personId),
          source: row.source,
          lastSeen: row.lastSeen,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
      : null;
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
