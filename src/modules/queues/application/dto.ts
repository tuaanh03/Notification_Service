import type { DeadLetter, QueueGroupDefinition, QueueGroupStats } from './ports/index.ts';

/** Màn Hàng chờ gửi, tab Stream (ADR-0042): mỗi consumer group một dòng. */
export interface QueuesDto {
  groups: (Omit<QueueGroupStats, 'consumers'> & {
    pausable: boolean;
    options: QueueGroupDefinition['options'];
    consumers: { name: string; pending: number; idleMs: number }[];
  })[];
  redis: { usedMemoryBytes: number };
}

/** Một message trong DLQ — không có payload (có thể chứa dữ liệu cá nhân), chỉ loại event + id đối tượng. */
export interface DeadLetterDto {
  id: string;
  stream: string;
  deadLetteredAt: string;
  group: string;
  reason: string;
  error: string;
  deliveries: number;
  eventType: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
}

export const toDeadLetterDto = (d: DeadLetter): DeadLetterDto => ({
  id: d.id,
  stream: d.stream,
  deadLetteredAt: d.deadLetteredAt.toISOString(),
  group: d.group,
  reason: d.reason,
  error: d.error,
  deliveries: d.deliveries,
  eventType: d.eventType,
  aggregateType: d.aggregateType,
  aggregateId: d.aggregateId,
});
