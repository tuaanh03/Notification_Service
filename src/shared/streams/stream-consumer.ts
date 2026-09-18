import type { UnitOfWork } from '../application/ports/unit-of-work.ts';
import type { ProcessedMessageStore } from '../db/index.ts';
import { DomainError } from '../kernel/errors.ts';
import type { Logger } from '../observability/logger.ts';
import { decodeMessage } from './codec.ts';
import { PermanentMessageError, type MessageHandler } from './contracts.ts';
import { dlqOf } from './names.ts';
import type { StreamClient, StreamEntry } from './stream-client.ts';

export interface ConsumerSpec {
  stream: string;
  group: string;
  /** Tên consumer trong group — duy nhất theo process, ví dụ `${group}-${hostname}-${pid}`. */
  consumer: string;
  handler: MessageHandler;
  batchSize?: number | undefined;
  /** Thời gian XREADGROUP chờ message mới; cũng là độ trễ tối đa khi dừng `run`. */
  blockMs?: number | undefined;
  /** Message treo lâu hơn ngưỡng này thì bị nhận lại (tài liệu §8.3: 60 s). */
  claimIdleMs?: number | undefined;
  /** Giao quá số lần này vẫn lỗi -> DLQ (tài liệu §8.3: 5). */
  maxDeliveries?: number | undefined;
  /** Nhịp quét message treo trong `run` (tài liệu §8.3: 30 s). */
  reclaimEveryMs?: number | undefined;
}

export interface ConsumeStats {
  processed: number;
  duplicates: number;
  /** Lỗi tạm: để lại trong PEL, lượt reclaim sau giao lại. */
  retried: number;
  deadLettered: number;
}

type ResolvedSpec = { [K in keyof ConsumerSpec]-?: Exclude<ConsumerSpec[K], undefined> };

const emptyStats = (): ConsumeStats => ({ processed: 0, duplicates: 0, retried: 0, deadLettered: 0 });

/**
 * Khung consumer dùng chung: mọi consumer chỉ khai stream, group và handler.
 *
 * Với MỖI message:
 *   uow.run {  markProcessed(group, dedupKey)  -> đã có: bỏ qua
 *              handler(message)                -> command nhập vào CÙNG transaction  }
 *   COMMIT rồi mới XACK.
 * Chết giữa COMMIT và XACK -> message được giao lại, dấu processed_messages chặn xử lý lần hai.
 *
 * Phân loại lỗi:
 *   - PermanentMessageError, DomainError, message hỏng -> DLQ ngay, ACK bản gốc.
 *     (DomainError = vi phạm invariant, tất định: thử lại cũng ra đúng lỗi đó.)
 *   - Lỗi khác (DB/Redis chập chờn...) -> KHÔNG ACK; `reclaimOnce` giao lại sau `claimIdleMs`,
 *     quá `maxDeliveries` lần thì DLQ.
 */
export class StreamConsumer {
  private readonly streams: StreamClient;
  private readonly uow: UnitOfWork;
  private readonly processedMessages: ProcessedMessageStore;
  private readonly logger: Logger;
  private readonly spec: ResolvedSpec;

  constructor(deps: {
    streams: StreamClient;
    uow: UnitOfWork;
    processedMessages: ProcessedMessageStore;
    logger: Logger;
    spec: ConsumerSpec;
  }) {
    this.streams = deps.streams;
    this.uow = deps.uow;
    this.processedMessages = deps.processedMessages;
    const spec = deps.spec;
    this.spec = {
      stream: spec.stream,
      group: spec.group,
      consumer: spec.consumer,
      handler: spec.handler,
      batchSize: spec.batchSize ?? 32,
      blockMs: spec.blockMs ?? 5_000,
      claimIdleMs: spec.claimIdleMs ?? 60_000,
      maxDeliveries: spec.maxDeliveries ?? 5,
      reclaimEveryMs: spec.reclaimEveryMs ?? 30_000,
    };
    this.logger = deps.logger.child(`consumer:${this.spec.group}`);
  }

  async ensureGroup(): Promise<void> {
    // '0': group tạo sau khi stream đã có message vẫn xử lý từ đầu, không bỏ sót.
    await this.streams.ensureGroup(this.spec.stream, this.spec.group, '0');
  }

  /** Đọc và xử lý một lô message MỚI. `blockMs` ghi đè để test không phải chờ. */
  async pollOnce(blockMs = this.spec.blockMs): Promise<ConsumeStats> {
    const { stream, group, consumer, batchSize } = this.spec;
    const entries = await this.streams.readGroup(stream, group, consumer, batchSize, blockMs);
    const stats = emptyStats();
    for (const entry of entries) await this.process(entry, 1, stats);
    return stats;
  }

  /** Nhận lại message treo quá `claimIdleMs`; quá `maxDeliveries` thì chuyển DLQ. */
  async reclaimOnce(): Promise<ConsumeStats> {
    const { stream, group, consumer, batchSize, claimIdleMs, maxDeliveries } = this.spec;
    const stats = emptyStats();
    const pending = await this.streams.pending(stream, group, claimIdleMs, batchSize);

    const exhausted = pending.filter((p) => p.deliveries >= maxDeliveries);
    for (const p of exhausted) {
      const entry = await this.streams.get(stream, p.id);
      if (entry) await this.deadLetter(entry, p.deliveries, 'max_deliveries', 'delivery limit reached');
      await this.streams.ack(stream, group, [p.id]);
      stats.deadLettered += 1;
    }

    const retry = pending.filter((p) => p.deliveries < maxDeliveries);
    const deliveries = new Map(retry.map((p) => [p.id, p.deliveries + 1]));
    const claimed = await this.streams.claim(stream, group, consumer, claimIdleMs, [...deliveries.keys()]);
    // Entry đã bị MAXLEN cắt khỏi stream: không còn gì để xử lý, ACK để dọn PEL.
    const gone = [...deliveries.keys()].filter((id) => !claimed.some((entry) => entry.id === id));
    await this.streams.ack(stream, group, gone);

    for (const entry of claimed) await this.process(entry, deliveries.get(entry.id) ?? 1, stats);
    return stats;
  }

  /** Vòng lặp chạy tới khi `signal` bị huỷ — entrypoint worker (lượt 3) gọi hàm này. */
  async run(signal: AbortSignal): Promise<void> {
    await this.ensureGroup();
    let nextReclaimAt = 0;
    while (!signal.aborted) {
      try {
        if (Date.now() >= nextReclaimAt) {
          await this.reclaimOnce();
          nextReclaimAt = Date.now() + this.spec.reclaimEveryMs;
        }
        await this.pollOnce();
      } catch (err) {
        if (signal.aborted) break;
        // Lỗi hạ tầng (mất Redis...): ghi log, lùi 1 giây rồi thử lại — không để vòng lặp chết.
        this.logger.error('consumer loop failed', { error: errorMessage(err) });
        await sleep(1_000, signal);
      }
    }
  }

  private async process(entry: StreamEntry, deliveryCount: number, stats: ConsumeStats): Promise<void> {
    const { stream, group } = this.spec;
    try {
      const message = decodeMessage(stream, entry.id, entry.fields, deliveryCount);
      const fresh = await this.uow.run(async () => {
        if (!(await this.processedMessages.markProcessed(group, message.dedupKey))) return false;
        await this.spec.handler(message);
        return true;
      });
      await this.streams.ack(stream, group, [entry.id]);
      if (fresh) stats.processed += 1;
      else stats.duplicates += 1;
    } catch (err) {
      if (isPermanent(err)) {
        await this.deadLetter(entry, deliveryCount, 'permanent_error', errorMessage(err));
        await this.streams.ack(stream, group, [entry.id]);
        stats.deadLettered += 1;
        return;
      }
      this.logger.warn('message failed, will retry', {
        stream,
        id: entry.id,
        deliveries: deliveryCount,
        error: errorMessage(err),
      });
      stats.retried += 1;
    }
  }

  private async deadLetter(entry: StreamEntry, deliveries: number, reason: string, error: string): Promise<void> {
    const { stream, group } = this.spec;
    await this.streams.add(dlqOf(stream), [
      ...entry.fields,
      'dlq_source_stream', stream,
      'dlq_source_id', entry.id,
      'dlq_group', group,
      'dlq_reason', reason,
      'dlq_error', error,
      'dlq_deliveries', String(deliveries),
    ]);
    this.logger.error('message dead-lettered', { stream, id: entry.id, reason, deliveries, error });
  }
}

function isPermanent(err: unknown): boolean {
  return err instanceof PermanentMessageError || err instanceof DomainError;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
