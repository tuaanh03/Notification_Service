import type { Redis } from 'ioredis';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Tìm ngày còn chỗ tối đa 30 ngày tới — quá xa thì dồn vào ngày cuối (không xảy ra với trần ≥ 100 và ≤ 100 thư / lần). */
const MAX_SCAN_DAYS = 30;

/**
 * Từ ngày `start` (ms của đầu ngày), ngày nào còn chỗ (< cap) thì lấy; `force` = không xét cap (vẫn cộng vào bộ đếm).
 * INCRBY trong cùng script nên nhiều process giữ lượt đồng thời không vượt cap. Hạn của key theo đồng hồ APPLICATION.
 * ARGV: prefix, start, cap, count, force, nowMs. Trả mảng đầu ngày (ms), mỗi lượt một phần tử.
 */
const RESERVE_SCRIPT = `
local prefix = ARGV[1]
local d = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local need = tonumber(ARGV[4])
local force = ARGV[5] == '1'
local now = tonumber(ARGV[6])
local last = d + ${MAX_SCAN_DAYS} * ${DAY_MS}
local out = {}
while need > 0 do
  local key = prefix .. d
  local used = tonumber(redis.call('GET', key) or '0')
  local room = cap - used
  if force or d >= last then room = need end
  if room > 0 then
    local take = math.min(room, need)
    redis.call('INCRBY', key, take)
    redis.call('PEXPIRE', key, math.max(d + 2 * ${DAY_MS} - now, ${DAY_MS}))
    for i = 1, take do out[#out + 1] = d end
    need = need - take
  end
  d = d + ${DAY_MS}
end
return out
`;

/**
 * Giữ trước lượt theo NGÀY, đếm trên Redis — trần thư mỗi ngày của hộp gửi chung (ADR-0041). Như `MinuteSlotAllocator`
 * nhưng theo ngày: ngày đầy thì lượt rơi sang ngày sau, không ai phải đứng chờ. Ranh giới ngày do người gọi chọn
 * (`start` là đầu ngày theo giờ Việt Nam).
 */
export class DaySlotAllocator {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(deps: { redis: Redis; keyPrefix: string }) {
    this.redis = deps.redis;
    this.keyPrefix = deps.keyPrefix;
  }

  /** Giữ `count` lượt từ ngày bắt đầu lúc `startMs`. Trả đầu ngày (ms) của từng lượt, tăng dần. */
  async reserve(bucket: string, startMs: number, cap: number, count: number, force: boolean, nowMs: number): Promise<number[]> {
    if (count <= 0) return [];
    const days = (await this.redis.eval(
      RESERVE_SCRIPT,
      0,
      `${this.keyPrefix}:${bucket}:`,
      startMs,
      cap,
      count,
      force ? '1' : '0',
      nowMs,
    )) as number[];
    return days.map(Number);
  }

  /** Số lượt đã giữ của ngày bắt đầu lúc `startMs`. */
  async used(bucket: string, startMs: number): Promise<number> {
    return Number((await this.redis.get(`${this.keyPrefix}:${bucket}:${startMs}`)) ?? 0);
  }
}
