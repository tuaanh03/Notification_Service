import { hostname } from 'node:os';
import { selectConsumers, type ConsumerRegistration, type Container } from '../composition/index.ts';
import type { RunningProcess } from './lifecycle.ts';

/**
 * Process `worker`: chạy các consumer group theo `WORKER_GROUPS`. `registry` = consumer của mọi
 * module (`consumerRegistry(application)`) — process này không biết module nào tồn tại. Mỗi group một `StreamConsumer.run`
 * — đọc stream, xử lý trong transaction, ACK, tự nhận lại message treo (XPENDING + XCLAIM) và đẩy
 * message hỏng vào DLQ. Chạy N bản song song an toàn: consumer group chia message, processed_messages
 * chặn xử lý trùng.
 */
export async function startWorker(
  container: Container,
  registry: readonly ConsumerRegistration[],
): Promise<RunningProcess> {
  const log = container.ports.logger.child('worker');
  const selected = selectConsumers(registry, container.env.WORKER_GROUPS);
  const controller = new AbortController();

  const consumers = selected.map((registration) =>
    container.infra.createConsumer({
      stream: registration.stream,
      group: registration.group,
      consumer: `${registration.group}-${hostname()}-${process.pid}`,
      handler: registration.handler,
      ...registration.options,
    }),
  );
  // Tạo group trước khi báo "started": lỗi Redis lộ ra ngay lúc khởi động, không lẩn vào vòng lặp.
  await Promise.all(consumers.map((consumer) => consumer.ensureGroup()));
  const running = consumers.map((consumer) => consumer.run(controller.signal));

  if (selected.length === 0) {
    log.warn('no consumer groups registered — worker is idle', { worker_groups: container.env.WORKER_GROUPS });
  } else {
    log.info('consumers running', { groups: selected.map((r) => r.group) });
  }

  return {
    stop: async () => {
      // Vòng lặp của consumer xử lý nốt message đang dở rồi thoát (tối đa `blockMs`).
      controller.abort();
      await Promise.all(running);
    },
  };
}
