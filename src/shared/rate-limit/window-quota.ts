import type { Redis } from 'ioredis';

/**
 * Cộng `count` vào khung; quá `limit` thì HOÀN lại và báo hết — một script, nhiều process cùng gọi không lọt quá mức.
 * Hạn của key theo đồng hồ APPLICATION (`ARGV[4]` = cuối khung, ms) — test chạy với đồng hồ giả.
 * KEYS: key. ARGV: count, limit, endMs, nowMs. Trả 1 (lấy được) / 0 (hết).
 */
const TAKE_SCRIPT = `
local n = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[3]) - tonumber(ARGV[4]) + 60000, 60000))
if n > tonumber(ARGV[2]) then
  redis.call('DECRBY', KEYS[1], tonumber(ARGV[1]))
  return 0
end
return 1
`;

/**
 * Hạn mức theo khung thời gian CỐ ĐỊNH (giờ, ngày…) đếm trên Redis — dùng chung mọi process (ADR-0032 GĐ 3: trần thư
 * mỗi giờ của app, số thư mỗi người nhận mỗi ngày). Khác `FixedWindowRateLimiter` (khung 1 phút, chờ lượt): ở đây khung
 * do người gọi truyền vào, và hết mức thì TỪ CHỐI chứ không chờ. Chỉ infrastructure import.
 */
export class WindowQuota {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(deps: { redis: Redis; keyPrefix: string }) {
    this.redis = deps.redis;
    this.keyPrefix = deps.keyPrefix;
  }

  /** Lấy `count` lượt trong khung `[startMs, endMs)`. `false` = vượt `limit`, không lấy gì. */
  async take(bucket: string, window: { startMs: number; endMs: number }, count: number, limit: number, nowMs: number): Promise<boolean> {
    const key = `${this.keyPrefix}:${bucket}:${window.startMs}`;
    return (await this.redis.eval(TAKE_SCRIPT, 1, key, count, limit, window.endMs, nowMs)) === 1;
  }
}
