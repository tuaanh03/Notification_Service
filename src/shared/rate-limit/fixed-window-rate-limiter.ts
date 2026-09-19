import type { Redis } from 'ioredis';
import type { Clock } from '../kernel/clock.ts';

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

const WINDOW_MS = 60_000;

/**
 * Giới hạn tốc độ theo cửa sổ 1 phút, đếm trên Redis — DÙNG CHUNG mọi process / mọi bản worker
 * (Exchange Online giới hạn theo mailbox gửi, không theo từng worker).
 *
 * Cửa sổ cố định (INCR `bucket:<phút>`), không phải token bucket trơn: đơn giản, một round-trip, đủ
 * để không vượt trần của mỗi phút. Đầu phút có thể dồn cục — chấp nhận ở MVP.
 * Tái dùng được cho quota theo app ở tầng API (`rate_limit_per_minute`, sau MVP).
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
    // INCR + đặt hạn trong MỘT round-trip; key tự biến mất sau 2 phút.
    const results = await this.redis.multi().incr(key).pexpire(key, 2 * WINDOW_MS).exec();
    const count = Number(results?.[0]?.[1] ?? Number.POSITIVE_INFINITY);
    if (count <= limitPerMinute) return { allowed: true };
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
