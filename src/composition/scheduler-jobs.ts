import {
  daysBefore,
  OUTBOX_RETENTION_DAYS,
  PROCESSED_MESSAGES_RETENTION_DAYS,
  purgeProcessedMessages,
  purgePublishedOutbox,
} from '../shared/db/index.ts';
import type { Job } from '../shared/jobs/index.ts';
import type { Container } from './container.ts';

export interface SchedulerTuning {
  relayEveryMs?: number | undefined;
  /** Relay tối đa bấy nhiêu lô mỗi nhịp, rồi nhường cho job khác và cho lần tắt process. */
  relayMaxBatchesPerTick?: number | undefined;
  cleanupEveryMs?: number | undefined;
}

/**
 * MỌI job định kỳ của process `scheduler`. Job nghiệp vụ (ví dụ `promote-scheduled`: `scheduled ->
 * queued` khi tới giờ) thêm vào đây khi module notifications có command tương ứng.
 */
export function schedulerJobs(container: Container, tuning: SchedulerTuning = {}): Job[] {
  const { clock, logger } = container.ports;
  const { database, outboxRelay } = container.infra;
  const log = logger.child('scheduler');
  const maxBatches = tuning.relayMaxBatchesPerTick ?? 20;

  return [
    {
      // Nhịp ngắn: đây là độ trễ từ lúc command commit tới lúc worker thấy event.
      name: 'outbox-relay',
      everyMs: tuning.relayEveryMs ?? 1_000,
      run: async () => {
        for (let batch = 0; batch < maxBatches; batch += 1) {
          if ((await outboxRelay.relayOnce()) === 0) return;
        }
      },
    },
    {
      name: 'purge-outbox',
      everyMs: tuning.cleanupEveryMs ?? 60 * 60 * 1_000,
      run: async () => {
        const deleted = await purgePublishedOutbox(database.db, daysBefore(clock.now(), OUTBOX_RETENTION_DAYS));
        if (deleted > 0) log.info('outbox purged', { deleted });
      },
    },
    {
      name: 'purge-processed-messages',
      everyMs: tuning.cleanupEveryMs ?? 60 * 60 * 1_000,
      run: async () => {
        const deleted = await purgeProcessedMessages(
          database.db,
          daysBefore(clock.now(), PROCESSED_MESSAGES_RETENTION_DAYS),
        );
        if (deleted > 0) log.info('processed messages purged', { deleted });
      },
    },
  ];
}
