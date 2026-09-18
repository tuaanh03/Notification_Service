import { eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import { AccountId, type AccountId as AccountIdType } from '../../../../shared/kernel/index.ts';
import type { AccountRepository } from '../../application/ports/index.ts';
import { Account } from '../../domain/entities/account.ts';
import { accounts } from '../db/schema.ts';

export class DrizzleAccountRepository implements AccountRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findById(id: AccountIdType): Promise<Account | null> {
    const [row] = await this.transactions.executor().select().from(accounts).where(eq(accounts.accountId, id));
    return row
      ? new Account({ id: AccountId.parse(row.accountId), name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt })
      : null;
  }

  async insert(account: Account): Promise<void> {
    await this.transactions.executor().insert(accounts).values({
      accountId: account.id,
      name: account.name,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });
  }
}
