import type { AccountId } from '../../../../shared/kernel/index.ts';
import type { Account } from '../../domain/entities/account.ts';

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>;
  insert(account: Account): Promise<void>;
}
