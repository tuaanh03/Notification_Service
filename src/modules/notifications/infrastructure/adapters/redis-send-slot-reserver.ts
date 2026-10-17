import type { AppId, Clock } from '../../../../shared/kernel/index.ts';
import type { MinuteSlotAllocator } from '../../../../shared/rate-limit/index.ts';
import type { SendSlotReserver } from '../../application/ports/index.ts';

/** Lượt gửi theo phút của từng app trên Redis (ADR-0032 GĐ 2) — bucket `pace:<appId>:<phút>`. */
export class RedisSendSlotReserver implements SendSlotReserver {
  private readonly allocator: MinuteSlotAllocator;
  private readonly clock: Clock;

  constructor(deps: { allocator: MinuteSlotAllocator; clock: Clock }) {
    this.allocator = deps.allocator;
    this.clock = deps.clock;
  }

  reserve(appId: AppId, limitPerMinute: number, from: Date, count: number): Promise<{ minute: number; index: number }[]> {
    return this.allocator.reserve(appId, limitPerMinute, from, count, this.clock.now());
  }
}
