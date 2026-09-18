import { asc, inArray, isNull } from 'drizzle-orm';
import type { UnitOfWork } from '../application/ports/unit-of-work.ts';
import { outbox, type TransactionContext } from '../db/index.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { encodeOutboxRecord } from './codec.ts';
import type { StreamClient } from './stream-client.ts';

export interface OutboxRelayOptions {
  /** Số dòng tối đa mỗi lượt (tài liệu kiến trúc §8.2: 500). */
  batchSize?: number | undefined;
}

/**
 * Đẩy event đã commit trong outbox sang Redis Streams — cầu nối giữa "DB là nguồn sự thật" và
 * "Redis là hàng đợi". Scheduler gọi `relayOnce` theo nhịp (lượt 3).
 *
 * Một lượt, trong MỘT transaction:
 *   1. SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED
 *      -> nhiều relay chạy song song lấy các lô KHÁC NHAU, không chờ nhau, không gửi trùng.
 *   2. XADD cả lô (pipeline, giữ thứ tự id).
 *   3. UPDATE published_at, COMMIT.
 *
 * Bảo đảm AT-LEAST-ONCE, không phải exactly-once:
 *   - XADD lỗi -> rollback, dòng vẫn chưa publish, lượt sau gửi lại. Không mất event.
 *   - XADD xong mà COMMIT hỏng -> lượt sau XADD LẠI (message id mới). Consumer khử trùng bằng
 *     `dedupKey = outbox:<id>`, không bằng message id — xem `contracts.ts`.
 * Mất Redis hoàn toàn: dòng chưa publish vẫn nằm trong outbox, Redis sống lại là relay tiếp.
 */
export class OutboxRelay {
  private readonly uow: UnitOfWork;
  private readonly transactions: TransactionContext;
  private readonly streams: StreamClient;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly batchSize: number;

  constructor(deps: {
    uow: UnitOfWork;
    transactions: TransactionContext;
    streams: StreamClient;
    clock: Clock;
    logger: Logger;
    options?: OutboxRelayOptions | undefined;
  }) {
    this.uow = deps.uow;
    this.transactions = deps.transactions;
    this.streams = deps.streams;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.batchSize = deps.options?.batchSize ?? 500;
  }

  /** Relay một lô. Trả số event đã đẩy (0 = outbox trống). */
  async relayOnce(): Promise<number> {
    return this.uow.run(async () => {
      const tx = this.transactions.require('OutboxRelay.relayOnce');
      const rows = await tx
        .select()
        .from(outbox)
        .where(isNull(outbox.publishedAt))
        .orderBy(asc(outbox.id))
        .limit(this.batchSize)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return 0;

      await this.streams.addMany(
        rows.map((row) => ({
          stream: row.stream,
          fields: encodeOutboxRecord({
            outboxId: String(row.id),
            stream: row.stream,
            eventType: row.eventType,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            payload: row.payload,
            createdAt: row.createdAt,
          }),
        })),
      );
      await tx
        .update(outbox)
        .set({ publishedAt: this.clock.now() })
        .where(inArray(outbox.id, rows.map((row) => row.id)));

      this.logger.debug('outbox relayed', { count: rows.length, lastId: String(rows.at(-1)!.id) });
      return rows.length;
    });
  }
}
