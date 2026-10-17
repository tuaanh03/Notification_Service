import type { Redis } from 'ioredis';

/** Một lượt gửi đã giữ: phút thứ `minute` (tính từ epoch) và vị trí `index` (0-based) trong phút đó. */
export interface MinuteSlot {
  minute: number;
  index: number;
}

const MINUTE_MS = 60_000;
/** Tìm lượt trống tối đa 7 ngày tới — quá xa thì dồn vào phút cuối (không xảy ra với trần ≥ 1 và ≤ 100 người / lần). */
const MAX_SCAN_MINUTES = 7 * 24 * 60;

/**
 * Tìm từ phút `start`, mỗi phút còn chỗ (< limit) thì lấy; INCRBY trong cùng script nên nhiều process
 * giữ lượt đồng thời không trùng. Hạn của key tính từ đồng hồ APPLICATION (`ARGV[5]`), không từ đồng hồ
 * Redis — test chạy với đồng hồ giả.
 * ARGV: prefix, start, limit, count, nowMs. Trả mảng phẳng [minute, index, minute, index, …].
 */
const RESERVE_SCRIPT = `
local prefix = ARGV[1]
local m = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local need = tonumber(ARGV[4])
local now = tonumber(ARGV[5])
local last = m + ${MAX_SCAN_MINUTES}
local out = {}
while need > 0 do
  local key = prefix .. m
  local used = tonumber(redis.call('GET', key) or '0')
  local room = limit - used
  if m >= last then room = need end
  if room > 0 then
    local take = math.min(room, need)
    redis.call('INCRBY', key, take)
    redis.call('PEXPIRE', key, math.max((m + 2) * ${MINUTE_MS} - now, ${MINUTE_MS}))
    for i = used, used + take - 1 do
      out[#out + 1] = m
      out[#out + 1] = i
    end
    need = need - take
  end
  m = m + 1
end
return out
`;

/**
 * Giữ trước lượt gửi theo phút, đếm trên Redis — dàn đều thư của một app (ADR-0032 GĐ 2). Khác
 * `FixedWindowRateLimiter` (hỏi "phút NÀY còn lượt không", chờ nếu hết): ở đây lượt được GIỮ cho phút tương
 * lai ngay lúc nhận thư, nên không ai phải đứng chờ.
 */
export class MinuteSlotAllocator {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(deps: { redis: Redis; keyPrefix?: string | undefined }) {
    this.redis = deps.redis;
    this.keyPrefix = deps.keyPrefix ?? 'pace';
  }

  async reserve(bucket: string, limitPerMinute: number, from: Date, count: number, now: Date): Promise<MinuteSlot[]> {
    if (count <= 0) return [];
    const flat = (await this.redis.eval(
      RESERVE_SCRIPT,
      0,
      `${this.keyPrefix}:${bucket}:`,
      Math.floor(from.getTime() / MINUTE_MS),
      limitPerMinute,
      count,
      now.getTime(),
    )) as number[];
    const slots: MinuteSlot[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) slots.push({ minute: Number(flat[i]), index: Number(flat[i + 1]) });
    return slots;
  }
}
