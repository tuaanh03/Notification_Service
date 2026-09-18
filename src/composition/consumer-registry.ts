import type { ConsumerSpec, MessageHandler } from '../shared/streams/index.ts';

/**
 * Một consumer group mà process `worker` có thể chạy. Module khai trong `ModuleDefinition.consumers`,
 * handler đã được dựng sẵn (từ `ports`) ở file ghép của module — handler không bao giờ nhận `infra`.
 */
export interface ConsumerRegistration {
  group: string;
  stream: string;
  handler: MessageHandler;
  options?:
    | Pick<ConsumerSpec, 'batchSize' | 'blockMs' | 'claimIdleMs' | 'maxDeliveries' | 'reclaimEveryMs' | 'idempotency'>
    | undefined;
}

/**
 * Chọn group theo `WORKER_GROUPS`. Tên không tồn tại -> lỗi ngay lúc khởi động: gõ sai tên group
 * mà worker vẫn chạy "bình thường" nghĩa là một hàng đợi không ai xử lý, lặng lẽ dồn lên.
 */
export function selectConsumers(
  registry: readonly ConsumerRegistration[],
  groups: 'all' | readonly string[],
): ConsumerRegistration[] {
  if (groups === 'all') return [...registry];
  const known = new Set(registry.map((r) => r.group));
  const unknown = groups.filter((g) => !known.has(g));
  if (unknown.length > 0) {
    throw new Error(
      `unknown WORKER_GROUPS: ${unknown.join(', ')} (registered: ${[...known].join(', ') || 'none'})`,
    );
  }
  return registry.filter((r) => groups.includes(r.group));
}
