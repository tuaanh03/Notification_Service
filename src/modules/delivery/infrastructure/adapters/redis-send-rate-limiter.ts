import type { FixedWindowRateLimiter } from '../../../../shared/rate-limit/index.ts';
import type { SendLane, SendRateLimiter } from '../../application/ports/index.ts';

/**
 * Một bucket cho mỗi mailbox gửi: Exchange Online đếm theo mailbox, không theo worker. Hai làn cùng đếm một bucket
 * (ADR-0041): làn thường dừng ở `maxPerMinute - reservePerMinute` (ít nhất 1), làn ưu tiên đi tới `maxPerMinute`.
 */
export class RedisSendRateLimiter implements SendRateLimiter {
  private readonly limiter: FixedWindowRateLimiter;
  private readonly bucket: string;
  private readonly limits: Record<SendLane, number>;

  constructor(deps: { limiter: FixedWindowRateLimiter; sender: string; maxPerMinute: number; reservePerMinute: number }) {
    this.limiter = deps.limiter;
    this.bucket = `email:${deps.sender.toLowerCase()}`;
    this.limits = {
      normal: Math.max(1, deps.maxPerMinute - deps.reservePerMinute),
      priority: deps.maxPerMinute,
    };
  }

  acquire(lane: SendLane): Promise<void> {
    return this.limiter.acquire(this.bucket, this.limits[lane]);
  }
}
