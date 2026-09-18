import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Executor, Transaction } from './client.ts';

export class TransactionRequiredError extends Error {
  constructor(operation: string) {
    super(`${operation} must run inside UnitOfWork.run()`);
    this.name = 'TransactionRequiredError';
  }
}

/**
 * Giữ transaction đang mở của chuỗi async hiện tại (AsyncLocalStorage).
 *
 * Nhờ vậy port ở tầng application (`UnitOfWork`, repository...) không phải mang tham số `tx`
 * có kiểu Drizzle: adapter hỏi context lấy executor. Đây là chỗ DUY NHẤT biết cơ chế này;
 * mọi adapter nhận `TransactionContext` qua constructor, không tự tạo.
 */
export class TransactionContext {
  private readonly db: Database;
  private readonly storage = new AsyncLocalStorage<Transaction>();

  constructor(db: Database) {
    this.db = db;
  }

  /** Transaction đang mở nếu có, không thì `db` — cho query đọc chạy được ở cả hai nơi. */
  executor(): Executor {
    return this.storage.getStore() ?? this.db;
  }

  /** Cho thao tác BẮT BUỘC nằm trong transaction (outbox, processed_messages, khoá dòng). */
  require(operation: string): Transaction {
    const tx = this.storage.getStore();
    if (!tx) throw new TransactionRequiredError(operation);
    return tx;
  }

  get active(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /** Chỉ `DrizzleUnitOfWork` gọi: mở transaction và gắn nó vào chuỗi async của `work`. */
  begin<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => this.storage.run(tx, work));
  }
}
