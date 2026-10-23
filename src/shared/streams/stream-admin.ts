import type { Redis } from 'ioredis';
import { dlqOf, pauseKeyOf } from './names.ts';
import { DEFAULT_MAX_LEN } from './stream-client.ts';

/** Một consumer (bản worker) trong group: còn sống thì `idleMs` nhỏ (chạm Redis gần đây). */
export interface ConsumerInfo {
  name: string;
  pending: number;
  idleMs: number;
}

/** Số đo của MỘT consumer group trên stream của nó (ADR-0042). */
export interface GroupStats {
  stream: string;
  group: string;
  /** Số entry còn trong stream (đã xử lý lẫn chưa — stream bị cắt theo MAXLEN, không phải hàng chờ thuần). */
  length: number;
  /** Entry group CHƯA nhận (đang xếp hàng). null = Redis không tính được (sau khi cắt / xoá entry). */
  lag: number | null;
  /** Đã giao cho worker nhưng chưa ACK (đang xử lý hoặc treo chờ giao lại). */
  pending: number;
  /** Message chưa ACK treo lâu nhất, ms. null = không có gì treo. */
  oldestPendingIdleMs: number | null;
  /** Số message trong `<stream>.dlq`. */
  deadLetters: number;
  consumers: ConsumerInfo[];
  paused: boolean;
}

/** Một message trong DLQ — field gốc đã tách khỏi field `dlq_*` do khung consumer thêm. */
export interface DeadLetterEntry {
  id: string;
  stream: string;
  /** Lúc vào DLQ, suy từ id của entry (ms trước dấu `-`). */
  deadLetteredAt: Date;
  group: string;
  reason: string;
  error: string;
  deliveries: number;
  eventType: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  sourceId: string | null;
}

const DLQ_FIELD = /^dlq_/;

/**
 * Đọc và thao tác hàng đợi Redis cho màn quản trị (ADR-0042) — tách khỏi `StreamClient` (đường xử lý message) vì đây là
 * việc của người vận hành: XINFO, đọc DLQ, đẩy lại, xoá, cờ tạm dừng. Không có lệnh xoá stream / group / cắt stream.
 */
export class StreamAdmin {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async groupStats(stream: string, group: string): Promise<GroupStats> {
    const [length, deadLetters, paused] = await Promise.all([
      this.len(stream),
      this.len(dlqOf(stream)),
      this.isPaused(group),
    ]);
    const info = (await this.groups(stream)).find((g) => g['name'] === group);
    const consumers = info ? await this.consumers(stream, group) : [];
    const oldest = info && Number(info['pending']) > 0 ? await this.oldestPendingIdle(stream, group) : null;
    return {
      stream,
      group,
      length,
      lag: info && info['lag'] !== null && info['lag'] !== undefined ? Number(info['lag']) : info ? null : 0,
      pending: info ? Number(info['pending'] ?? 0) : 0,
      oldestPendingIdleMs: oldest,
      deadLetters,
      consumers,
      paused,
    };
  }

  /** Message trong DLQ của `stream`, mới nhất trước. */
  async deadLetters(stream: string, limit: number): Promise<DeadLetterEntry[]> {
    const raw = (await this.redis.call('XREVRANGE', dlqOf(stream), '+', '-', 'COUNT', limit)) as [string, string[]][];
    return raw.map(([id, fields]) => toDeadLetter(stream, id, fields ?? []));
  }

  async deadLetter(stream: string, id: string): Promise<DeadLetterEntry | null> {
    const raw = (await this.redis.call('XRANGE', dlqOf(stream), id, id)) as [string, string[]][];
    const entry = raw[0];
    return entry ? toDeadLetter(stream, entry[0], entry[1] ?? []) : null;
  }

  /**
   * Đưa message trong DLQ về stream gốc (field gốc, bỏ `dlq_*`) rồi xoá khỏi DLQ — một MULTI. Consumer coi như message
   * mới; khử trùng vẫn theo `outbox_id` / trạng thái trong DB (ADR-0013), nên đẩy lại message đã xử lý xong không làm hai lần.
   * Trả id mới trên stream gốc, null nếu message không còn trong DLQ.
   */
  async requeue(stream: string, id: string): Promise<string | null> {
    const raw = (await this.redis.call('XRANGE', dlqOf(stream), id, id)) as [string, string[]][];
    const entry = raw[0];
    if (!entry) return null;
    const original: string[] = [];
    const fields = entry[1] ?? [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (!DLQ_FIELD.test(fields[i]!)) original.push(fields[i]!, fields[i + 1]!);
    }
    const results = await this.redis
      .multi()
      .call('XADD', stream, 'MAXLEN', '~', DEFAULT_MAX_LEN, '*', ...original)
      .call('XDEL', dlqOf(stream), id)
      .exec();
    const failed = results?.find(([err]) => err);
    if (failed?.[0]) throw failed[0];
    return String(results?.[0]?.[1]);
  }

  /** Xoá hẳn một message khỏi DLQ. false = không còn. */
  async discard(stream: string, id: string): Promise<boolean> {
    return Number(await this.redis.call('XDEL', dlqOf(stream), id)) > 0;
  }

  /** Cờ tạm dừng của group — đọc bởi vòng lặp consumer (`StreamClient.isPaused`), dùng chung mọi bản worker. */
  async setPaused(group: string, paused: boolean): Promise<void> {
    if (paused) await this.redis.set(pauseKeyOf(group), '1');
    else await this.redis.del(pauseKeyOf(group));
  }

  async isPaused(group: string): Promise<boolean> {
    return (await this.redis.exists(pauseKeyOf(group))) === 1;
  }

  /** Bộ nhớ Redis đang dùng (byte) — từ `INFO memory`. */
  async usedMemory(): Promise<number> {
    const info = String(await this.redis.call('INFO', 'memory'));
    return Number(/^used_memory:(\d+)/m.exec(info)?.[1] ?? 0);
  }

  private async len(stream: string): Promise<number> {
    return Number(await this.redis.call('XLEN', stream));
  }

  private async groups(stream: string): Promise<Record<string, unknown>[]> {
    try {
      return ((await this.redis.call('XINFO', 'GROUPS', stream)) as unknown[][]).map(pairs);
    } catch (err) {
      // Stream chưa có (chưa từng có message, group chưa tạo) — không phải lỗi của màn quản trị.
      if (err instanceof Error && /no such key/i.test(err.message)) return [];
      throw err;
    }
  }

  private async consumers(stream: string, group: string): Promise<ConsumerInfo[]> {
    const raw = (await this.redis.call('XINFO', 'CONSUMERS', stream, group)) as unknown[][];
    return raw.map(pairs).map((c) => ({ name: String(c['name']), pending: Number(c['pending'] ?? 0), idleMs: Number(c['idle'] ?? 0) }));
  }

  private async oldestPendingIdle(stream: string, group: string): Promise<number | null> {
    const raw = (await this.redis.call('XPENDING', stream, group, '-', '+', 1)) as [string, string, number, number][];
    return raw[0] ? Number(raw[0][2]) : null;
  }
}

/** Trả lời dạng phẳng `[k1, v1, k2, v2…]` của XINFO (RESP2) -> object. */
function pairs(flat: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = flat[i + 1];
  return out;
}

function toDeadLetter(stream: string, id: string, fields: readonly string[]): DeadLetterEntry {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) map.set(fields[i]!, fields[i + 1]!);
  return {
    id,
    stream,
    deadLetteredAt: new Date(Number(id.split('-')[0])),
    group: map.get('dlq_group') ?? '',
    reason: map.get('dlq_reason') ?? '',
    error: map.get('dlq_error') ?? '',
    deliveries: Number(map.get('dlq_deliveries') ?? 0),
    eventType: map.get('event_type') ?? null,
    aggregateType: map.get('aggregate_type') ?? null,
    aggregateId: map.get('aggregate_id') ?? null,
    sourceId: map.get('dlq_source_id') ?? null,
  };
}
