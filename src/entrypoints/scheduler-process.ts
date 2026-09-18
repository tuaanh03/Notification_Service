import { schedulerJobs, type Container, type SchedulerTuning } from '../composition/index.ts';
import { JobRunner } from '../shared/jobs/index.ts';
import type { RunningProcess } from './lifecycle.ts';

/**
 * Process `scheduler`: việc theo nhịp thời gian — relay outbox sang Redis, dọn bảng cũ, và (sau này)
 * chuyển thông báo hẹn giờ sang `queued`. Không nhận HTTP, không đọc stream.
 */
export async function startScheduler(container: Container, tuning: SchedulerTuning = {}): Promise<RunningProcess> {
  const runner = new JobRunner({ logger: container.ports.logger, jobs: schedulerJobs(container, tuning) });
  runner.start();
  return { stop: () => runner.stop() };
}
