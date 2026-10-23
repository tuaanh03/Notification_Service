import { DiscardDeadLetter, QueueQueries, RequeueDeadLetter, SetGroupPaused, type QueueGroupDefinition } from '../../modules/queues/application/index.ts';
import { adminQueuesRoutes } from '../../modules/queues/interface/index.ts';
import { CONSUMER_DEFAULTS, StreamAdmin } from '../../shared/streams/index.ts';
import type { ConsumerRegistration } from '../consumer-registry.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module queues — màn quản trị hàng đợi (ADR-0042). Dựng SAU mọi module khác: danh sách consumer group lấy từ
 * registry của chúng (thông số gộp mặc định của khung consumer). Chỉ process api có route; worker đọc cờ tạm dừng
 * trực tiếp trên Redis.
 */
export function queuesModule(container: Container, dependencies: { consumers: readonly ConsumerRegistration[] }): ModuleDefinition {
  const { uow, outbox } = container.ports;
  const admin = new StreamAdmin(container.infra.redis.client);
  const groups: QueueGroupDefinition[] = dependencies.consumers.map((c) => ({
    stream: c.stream,
    group: c.group,
    pausable: c.pausable ?? true,
    options: {
      batchSize: c.options?.batchSize ?? CONSUMER_DEFAULTS.batchSize,
      blockMs: c.options?.blockMs ?? CONSUMER_DEFAULTS.blockMs,
      claimIdleMs: c.options?.claimIdleMs ?? CONSUMER_DEFAULTS.claimIdleMs,
      maxDeliveries: c.options?.maxDeliveries ?? CONSUMER_DEFAULTS.maxDeliveries,
      reclaimEveryMs: c.options?.reclaimEveryMs ?? CONSUMER_DEFAULTS.reclaimEveryMs,
      idempotency: c.options?.idempotency ?? 'framework',
    },
  }));
  const queries = new QueueQueries({ admin, groups });
  const deps = { uow, outbox, admin, queries };
  return {
    name: 'queues',
    http: {
      admin: [
        adminQueuesRoutes({
          queries,
          requeue: new RequeueDeadLetter(deps),
          discard: new DiscardDeadLetter(deps),
          setPaused: new SetGroupPaused(deps),
        }),
      ],
    },
  };
}
