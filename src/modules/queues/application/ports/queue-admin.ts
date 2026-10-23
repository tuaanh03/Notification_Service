/**
 * PORT: đọc và thao tác hàng đợi (Redis Streams) cho màn quản trị (ADR-0042). Hiện thực là `StreamAdmin` ở
 * `shared/streams` — module không chạm client Redis (luật kiến trúc), composition truyền vào.
 */
export interface QueueAdmin {
  groupStats(stream: string, group: string): Promise<QueueGroupStats>;
  /** Message trong DLQ của `stream`, mới nhất trước. */
  deadLetters(stream: string, limit: number): Promise<DeadLetter[]>;
  deadLetter(stream: string, id: string): Promise<DeadLetter | null>;
  /** Về stream gốc + xoá khỏi DLQ. Trả id mới, null nếu không còn trong DLQ. */
  requeue(stream: string, id: string): Promise<string | null>;
  /** Xoá khỏi DLQ. false = không còn. */
  discard(stream: string, id: string): Promise<boolean>;
  setPaused(group: string, paused: boolean): Promise<void>;
  isPaused(group: string): Promise<boolean>;
  usedMemory(): Promise<number>;
}

export interface QueueGroupStats {
  stream: string;
  group: string;
  length: number;
  lag: number | null;
  pending: number;
  oldestPendingIdleMs: number | null;
  deadLetters: number;
  consumers: { name: string; pending: number; idleMs: number }[];
  paused: boolean;
}

export interface DeadLetter {
  id: string;
  stream: string;
  deadLetteredAt: Date;
  group: string;
  reason: string;
  error: string;
  deliveries: number;
  eventType: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  sourceId: string | null;
}

/**
 * Một consumer group đang được worker chạy — composition khai từ registry của mọi module (thông số đã gộp mặc định).
 * `pausable: false` = không cho tạm dừng trên màn quản trị (ghi nhật ký hệ thống: dừng là mất dấu vết thao tác).
 */
export interface QueueGroupDefinition {
  stream: string;
  group: string;
  pausable: boolean;
  options: {
    batchSize: number;
    blockMs: number;
    claimIdleMs: number;
    maxDeliveries: number;
    reclaimEveryMs: number;
    idempotency: 'framework' | 'handler';
  };
}
