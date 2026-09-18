import { schedulerJobs, type Container, type SchedulerTuning } from '../composition/index.ts';
import { JobRunner, type Job } from '../shared/jobs/index.ts';
import type { RunningProcess } from './lifecycle.ts';

/**
 * Process `scheduler`: việc theo nhịp thời gian — job hạ tầng (relay outbox, dọn bảng cũ) cộng job
 * nghiệp vụ của các module (`moduleJobs(application)`). Không nhận HTTP, không đọc stream.
 */
export async function startScheduler(
  container: Container,
  moduleJobs: readonly Job[] = [],
  tuning: SchedulerTuning = {},
): Promise<RunningProcess> {
  const runner = new JobRunner({
    logger: container.ports.logger,
    jobs: [...schedulerJobs(container, tuning), ...moduleJobs],
  });
  runner.start();
  return { stop: () => runner.stop() };
}
