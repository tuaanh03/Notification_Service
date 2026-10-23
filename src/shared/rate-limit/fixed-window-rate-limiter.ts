import type { Redis } from 'ioredis';
import type { Clock } from '../kernel/clock.ts';

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

const WINDOW_MS = 60_000;

/**
 * Lấy một lượt; quá `limit` thì HOÀN lại. Lượt bị từ chối không được tính — nếu tính, bên hỏi với mức thấp (làn
 * thường) liên tục bị từ chối sẽ đẩy bộ đếm vượt luôn mức cao hơn của bên khác (làn ưu tiên) cùng bucket.
 * KEYS: key. ARGV: limit, ttlMs. Trả 1 (lấy được) / 0 (hết lượt).
 */
const TAKE_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

/**
 * Giới hạn tốc độ theo cửa sổ 1 phút, đếm trên Redis — DÙNG CHUNG mọi process / mọi bản worker
 * (Exchange Online giới hạn theo mailbox gửi, không theo từng worker).
 *
 * Cửa sổ cố định (INCR `bucket:<phút>`), không phải token bucket trơn: đơn giản, một round-trip, đủ
 * để không vượt trần của mỗi phút. Đầu phút có thể dồn cục — chấp nhận ở MVP.
 * Cùng một bucket hỏi được với các mức khác nhau (ADR-0041: làn thường dừng ở `trần - phần giữ`, làn ưu tiên tới trần).
 */
export class FixedWindowRateLimiter {
  private readonly redis: Redis;
  private readonly clock: Clock;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly keyPrefix: string;

  constructor(deps: { redis: Redis; clock: Clock; sleep: (ms: number) => Promise<void>; keyPrefix?: string | undefined }) {
    this.redis = deps.redis;
    this.clock = deps.clock;
    this.sleep = deps.sleep;
    this.keyPrefix = deps.keyPrefix ?? 'ratelimit';
  }

  async tryAcquire(bucket: string, limitPerMinute: number): Promise<RateLimitDecision> {
    const now = this.clock.now().getTime();
    const window = Math.floor(now / WINDOW_MS);
    const key = `${this.keyPrefix}:${bucket}:${window}`;
    // Lấy + đặt hạn + hoàn lượt nếu hết, trong MỘT script; key tự biến mất sau 2 phút.
    if ((await this.redis.eval(TAKE_SCRIPT, 1, key, limitPerMinute, 2 * WINDOW_MS)) === 1) return { allowed: true };
    return { allowed: false, retryAfterMs: (window + 1) * WINDOW_MS - now };
  }

  /** Chờ tới khi có lượt. Jitter nhỏ để các worker không cùng ùa vào đúng mốc đầu phút. */
  async acquire(bucket: string, limitPerMinute: number): Promise<void> {
    for (;;) {
      const decision = await this.tryAcquire(bucket, limitPerMinute);
      if (decision.allowed) return;
      await this.sleep(decision.retryAfterMs + Math.floor(Math.random() * 250));
    }
  }
}
