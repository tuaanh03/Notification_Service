import type { Job } from '../../../../shared/jobs/index.ts';
import type { PromoteScheduled } from '../../application/index.ts';

/** Mỗi 15 giây: thư chờ khung giờ gửi đã tới giờ -> `queued` (ADR-0032). Trễ tối đa ~15 giây sau giờ mở khung. */
export function promoteScheduledJob(useCases: { promoteScheduled: PromoteScheduled }, everyMs = 15_000): Job {
  return {
    name: 'promote-scheduled',
    everyMs,
    run: async () => {
      // Thả hết thư tới giờ trong một nhịp — lô 500, dừng khi lô không đầy.
      while ((await useCases.promoteScheduled.execute(500)) === 500);
    },
  };
}
