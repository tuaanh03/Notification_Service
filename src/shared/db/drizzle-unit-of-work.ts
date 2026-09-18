import type { UnitOfWork } from '../application/ports/unit-of-work.ts';
import type { TransactionContext } from './transaction-context.ts';

/** Hiện thực `UnitOfWork` trên transaction MySQL của Drizzle. */
export class DrizzleUnitOfWork implements UnitOfWork {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    // Lồng nhau -> nhập vào transaction ngoài. Không dùng SAVEPOINT: một command là một
    // transaction, rollback một phần sẽ để lại trạng thái nửa vời khó suy luận.
    if (this.transactions.active) return work();
    return this.transactions.begin(work);
  }
}
