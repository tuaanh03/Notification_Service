import type { FixedWindowRateLimiter } from '../../../../shared/rate-limit/index.ts';
import type { SendRateLimiter } from '../../application/ports/index.ts';

/** Một bucket cho mỗi mailbox gửi: Exchange Online đếm theo mailbox, không theo worker. */
export class RedisSendRateLimiter implements SendRateLimiter {
  private readonly limiter: FixedWindowRateLimiter;
  private readonly bucket: string;
  private readonly maxPerMinute: number;

  constructor(deps: { limiter: FixedWindowRateLimiter; sender: string; maxPerMinute: number }) {
    this.limiter = deps.limiter;
    this.bucket = `email:${deps.sender.toLowerCase()}`;
    this.maxPerMinute = deps.maxPerMinute;
  }

  acquire(): Promise<void> {
    return this.limiter.acquire(this.bucket, this.maxPerMinute);
  }
}
