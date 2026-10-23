import { consumerRegistry, type Application, type Container } from '../../../src/composition/index.ts';
import type { ConsumeStats } from '../../../src/shared/streams/index.ts';

/** Worker gửi email đủ HAI làn (ADR-0041): `email-sender` (thư thường) + `email-sender-priority` (tin bắt buộc). */
export interface EmailWorkers {
  ensureGroup(): Promise<void>;
  /** Một lượt đọc của CẢ HAI làn; `processed` cộng lại — vòng `while (processed > 0)` vét sạch cả hai. */
  pollOnce(blockMs?: number): Promise<Pick<ConsumeStats, 'processed'>>;
}

/** Consumer THẬT của worker (idempotency: 'handler') lấy từ registry của ứng dụng, mỗi làn một consumer. */
export function emailWorkers(application: Application, c: Container, consumer = 'w1', batchSize = 10): EmailWorkers {
  const lanes = ['email-sender', 'email-sender-priority'].map((group) => {
    const r = consumerRegistry(application).find((x) => x.group === group)!;
    return c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer, handler: r.handler, batchSize });
  });
  return {
    ensureGroup: async () => {
      for (const lane of lanes) await lane.ensureGroup();
    },
    pollOnce: async (blockMs = 0) => {
      let processed = 0;
      for (const lane of lanes) processed += (await lane.pollOnce(blockMs)).processed;
      return { processed };
    },
  };
}
