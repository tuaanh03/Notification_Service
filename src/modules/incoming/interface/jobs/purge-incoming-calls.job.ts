import type { Job } from '../../../../shared/jobs/index.ts';
import type { PurgeIncomingCalls } from '../../application/index.ts';

/** Mỗi giờ: xoá nhật ký gọi incoming webhook cũ hơn 30 ngày. */
export function purgeIncomingCallsJob(useCases: { purge: PurgeIncomingCalls }, everyMs = 3_600_000): Job {
  return {
    name: 'purge-incoming-calls',
    everyMs,
    run: async () => {
      await useCases.purge.execute();
    },
  };
}
