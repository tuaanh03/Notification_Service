import type { AccountId } from '../../../../shared/kernel/index.ts';
import type { Account } from '../../domain/entities/account.ts';

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>;
  insert(account: Account): Promise<void>;
  /**
   * Mọi account, cũ nhất trước. Chỉ CLI dùng: tạo admin phải gắn vào một account, mà người chạy
   * CLI trên máy chủ mới không có cách nào biết id đó. Không có route HTTP nào gọi hàm này.
   */
  listAll(): Promise<Account[]>;
}
