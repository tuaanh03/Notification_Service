import type { Redis } from 'ioredis';

/** Một entry đọc được từ stream: id + danh sách phẳng field/value. */
export interface StreamEntry {
  id: string;
  fields: string[];
}

export interface PendingEntry {
  id: string;
  consumer: string;
  idleMs: number;
  /** Số lần đã giao (tính cả lần hiện tại đang treo). */
  deliveries: number;
}

/**
 * Stream không phải lịch sử — cắt bớt khi dài. `~` cho phép Redis cắt theo node (rẻ), không
 * chính xác từng entry. Lịch sử thật ở MySQL.
 */
export const DEFAULT_MAX_LEN = 1_000_000;

/**
 * Lớp mỏng quanh lệnh stream của Redis. Kết quả parse theo dạng RESP2 — kết nối PHẢI mở bằng
 * `protocol: 2` (xem `createRedis`). Gọi qua `call(...)` với lệnh tường minh thay vì các
 * overload của ioredis (hàng chục chữ ký mỗi lệnh): đọc là biết lệnh Redis nào chạy, và mọi chỗ
 * parse kết quả thô nằm ở MỘT file này.
 */
export class StreamClient {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async add(stream: string, fields: readonly string[], maxLen = DEFAULT_MAX_LEN): Promise<string> {
    return String(await this.redis.call('XADD', stream, 'MAXLEN', '~', maxLen, '*', ...fields));
  }

  /**
   * Nhiều XADD trong MỘT round-trip, giữ đúng thứ tự. Lỗi ở bất kỳ lệnh nào -> throw
   * (các lệnh trước đó có thể đã vào stream — caller phải chịu được gửi lặp).
   */
  async addMany(
    entries: readonly { stream: string; fields: readonly string[] }[],
    maxLen = DEFAULT_MAX_LEN,
  ): Promise<string[]> {
    if (entries.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const entry of entries) {
      pipeline.call('XADD', entry.stream, 'MAXLEN', '~', maxLen, '*', ...entry.fields);
    }
    const results = (await pipeline.exec()) ?? [];
    return results.map(([err, id], index) => {
      if (err) throw new Error(`XADD to ${entries[index]?.stream} failed: ${err.message}`, { cause: err });
      return String(id);
    });
  }

  /** Tạo consumer group (kèm stream nếu chưa có). Đã tồn tại thì bỏ qua. */
  async ensureGroup(stream: string, group: string, startId = '0'): Promise<void> {
    try {
      await this.redis.call('XGROUP', 'CREATE', stream, group, startId, 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error && err.message.startsWith('BUSYGROUP'))) throw err;
    }
  }

  /** Message MỚI (`>`) chưa giao cho ai trong group. `blockMs = 0` = không block. */
  async readGroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
  ): Promise<StreamEntry[]> {
    const args: (string | number)[] = ['GROUP', group, consumer, 'COUNT', count];
    if (blockMs > 0) args.push('BLOCK', blockMs);
    args.push('STREAMS', stream, '>');
    const reply = (await this.redis.call('XREADGROUP', ...args)) as [string, RawEntry[]][] | null;
    return reply?.[0] ? parseEntries(reply[0][1]) : [];
  }

  /** Message đang treo trong PEL lâu hơn `minIdleMs` (consumer chết / handler lỗi tạm). */
  async pending(stream: string, group: string, minIdleMs: number, count: number): Promise<PendingEntry[]> {
    const reply = (await this.redis.call(
      'XPENDING', stream, group, 'IDLE', minIdleMs, '-', '+', count,
    )) as [string, string, number, number][];
    return reply.map(([id, consumer, idleMs, deliveries]) => ({
      id,
      consumer,
      idleMs: Number(idleMs),
      deliveries: Number(deliveries),
    }));
  }

  /**
   * Chuyển quyền sở hữu message treo sang `consumer` (tăng số lần giao lên 1). Entry đã bị
   * MAXLEN cắt khỏi stream thì không trả về — caller ACK chúng để dọn PEL.
   */
  async claim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    ids: readonly string[],
  ): Promise<StreamEntry[]> {
    if (ids.length === 0) return [];
    const reply = (await this.redis.call('XCLAIM', stream, group, consumer, minIdleMs, ...ids)) as (RawEntry | null)[];
    return parseEntries(reply.filter((entry): entry is RawEntry => entry !== null));
  }

  async ack(stream: string, group: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return Number(await this.redis.call('XACK', stream, group, ...ids));
  }

  /** Đọc đúng một entry theo id (để chép sang DLQ). */
  async get(stream: string, id: string): Promise<StreamEntry | null> {
    const reply = (await this.redis.call('XRANGE', stream, id, id)) as RawEntry[];
    return parseEntries(reply)[0] ?? null;
  }

  async length(stream: string): Promise<number> {
    return Number(await this.redis.call('XLEN', stream));
  }

  /** Toàn bộ entry của stream — cho test và màn hình DLQ, không dùng trên stream lớn. */
  async range(stream: string, count = 1000): Promise<StreamEntry[]> {
    return parseEntries((await this.redis.call('XRANGE', stream, '-', '+', 'COUNT', count)) as RawEntry[]);
  }
}

type RawEntry = [string, string[] | null];

function parseEntries(raw: readonly RawEntry[]): StreamEntry[] {
  return raw.map(([id, fields]) => ({ id, fields: fields ?? [] }));
}
