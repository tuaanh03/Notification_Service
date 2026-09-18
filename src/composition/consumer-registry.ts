import type { ConsumerSpec, MessageHandler } from '../shared/streams/index.ts';
import type { Container } from './container.ts';

/**
 * Một consumer group mà process `worker` có thể chạy. Handler được dựng từ `ports` —
 * handler (tầng interface của module) không bao giờ nhận `infra`.
 */
export interface ConsumerRegistration {
  group: string;
  stream: string;
  handler: (ports: Container['ports']) => MessageHandler;
  options?: Pick<ConsumerSpec, 'batchSize' | 'blockMs' | 'claimIdleMs' | 'maxDeliveries' | 'reclaimEveryMs'> | undefined;
}

/**
 * MỌI consumer group của hệ thống — nơi duy nhất liệt kê. Module thêm consumer thì thêm một dòng
 * ở đây, handler đặt ở `modules/<x>/interface/consumers/`. Lượt 4 (module apps) đăng ký dòng đầu tiên.
 */
export const CONSUMER_REGISTRY: readonly ConsumerRegistration[] = [];

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
