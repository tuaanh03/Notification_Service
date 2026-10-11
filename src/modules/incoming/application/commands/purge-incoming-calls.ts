import type { Clock } from '../../../../shared/kernel/index.ts';
import type { IncomingCallRepository } from '../ports/index.ts';

/** Nhật ký gọi giữ 30 ngày — lần gọi bị từ chối cũng được ghi, không dọn là bảng phình mãi. */
export const INCOMING_CALL_RETENTION_MS = 30 * 24 * 60 * 60_000;
const BATCH = 5_000;

export class PurgeIncomingCalls {
  private readonly deps: { clock: Clock; calls: IncomingCallRepository };

  constructor(deps: PurgeIncomingCalls['deps']) {
    this.deps = deps;
  }

  async execute(): Promise<number> {
    const before = new Date(this.deps.clock.now().getTime() - INCOMING_CALL_RETENTION_MS);
    let total = 0;
    for (;;) {
      const removed = await this.deps.calls.purgeOlderThan(before, BATCH);
      total += removed;
      if (removed < BATCH) return total;
    }
  }
}
