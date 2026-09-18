import type { Job } from '../../../../shared/jobs/index.ts';
import type { FailStuckSending } from '../../application/index.ts';

/** Mỗi phút: chốt `failed / outcome_unknown` cho notification kẹt ở `sending` (at-most-once). */
export function failStuckSendingJob(useCases: { failStuckSending: FailStuckSending }, everyMs = 60_000): Job {
  return {
    name: 'fail-stuck-sending',
    everyMs,
    run: async () => {
      await useCases.failStuckSending.execute();
    },
  };
}
