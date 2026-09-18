import type { Logger } from '../observability/logger.ts';

/** Một việc định kỳ của process `scheduler`. */
export interface Job {
  name: string;
  /** Khoảng nghỉ GIỮA hai lần chạy (tính từ lúc lần trước xong, không phải lúc bắt đầu). */
  everyMs: number;
  run(): Promise<void>;
}

/**
 * Chạy các job theo nhịp, mỗi job một vòng riêng:
 *   - KHÔNG chồng lần: lần sau chỉ hẹn giờ khi lần trước đã xong — relay chậm không đẻ ra hai relay
 *     song song trong cùng process.
 *   - Job lỗi thì ghi log và chạy lại ở nhịp sau — một job hỏng không làm chết cả scheduler.
 *   - `stop()` huỷ các lần hẹn và CHỜ lần đang chạy kết thúc, để shutdown không cắt ngang transaction.
 * An toàn khi chạy nhiều bản scheduler: từng job tự lo tranh chấp (SKIP LOCKED, DELETE idempotent).
 */
export class JobRunner {
  private readonly logger: Logger;
  private readonly jobs: readonly Job[];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<Promise<void>>();
  private stopped = true;

  constructor(deps: { logger: Logger; jobs: readonly Job[] }) {
    this.logger = deps.logger.child('jobs');
    this.jobs = deps.jobs;
  }

  start(): void {
    this.stopped = false;
    for (const job of this.jobs) this.schedule(job, 0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all(this.inFlight);
  }

  private schedule(job: Job, delayMs: number): void {
    if (this.stopped) return;
    this.timers.set(job.name, setTimeout(() => void this.tick(job), delayMs));
  }

  private async tick(job: Job): Promise<void> {
    const run = job.run().catch((err: unknown) => {
      this.logger.error('job failed', { job: job.name, error: err instanceof Error ? err.message : String(err) });
    });
    this.inFlight.add(run);
    try {
      await run;
    } finally {
      this.inFlight.delete(run);
      this.schedule(job, job.everyMs);
    }
  }
}
