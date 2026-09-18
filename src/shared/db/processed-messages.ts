import { isDuplicateKeyError } from './errors.ts';
import { processedMessages } from './schema.ts';
import type { TransactionContext } from './transaction-context.ts';

/**
 * Chốt idempotent của consumer — dùng bởi khung consumer (`shared/streams`), không phải bởi
 * application. Gọi ĐẦU TIÊN, trong CÙNG `UnitOfWork.run` với việc xử lý:
 *   - `true`  -> lần đầu thấy message này, xử lý tiếp;
 *   - `false` -> đã xử lý rồi (Redis Streams at-least-once), bỏ qua và ACK.
 * Handler lỗi -> ROLLBACK kéo luôn dòng đánh dấu, lần giao lại sẽ được xử lý lại. Đánh dấu
 * ngoài transaction thì một message lỗi giữa chừng sẽ bị coi là "đã xong" mãi mãi.
 *
 * Dựa vào PRIMARY KEY từ chối INSERT trùng, không dùng INSERT IGNORE: IGNORE nuốt cả lỗi
 * khác (cắt chuỗi, sai kiểu) thành warning.
 */
export class ProcessedMessageStore {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async markProcessed(consumerGroup: string, messageId: string): Promise<boolean> {
    const tx = this.transactions.require('ProcessedMessageStore.markProcessed');
    try {
      await tx.insert(processedMessages).values({ consumerGroup, messageId });
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }
}
