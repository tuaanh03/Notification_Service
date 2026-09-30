import type { FixedWindowRateLimiter } from '../../../../shared/rate-limit/index.ts';
import type { AiComposeRateLimiter } from '../../application/ports/index.ts';

/** Mỗi admin một bucket, đếm chung mọi bản api (Redis). Hết lượt thì báo ngay, không chờ. */
export class RedisAiComposeRateLimiter implements AiComposeRateLimiter {
  private readonly limiter: FixedWindowRateLimiter;
  private readonly maxPerMinute: number;

  constructor(deps: { limiter: FixedWindowRateLimiter; maxPerMinute: number }) {
    this.limiter = deps.limiter;
    this.maxPerMinute = deps.maxPerMinute;
  }

  async tryAcquire(adminId: string): Promise<boolean> {
    return (await this.limiter.tryAcquire(`ai-compose:${adminId}`, this.maxPerMinute)).allowed;
  }
}
