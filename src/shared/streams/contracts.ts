/**
 * Hợp đồng giữa khung consumer (hạ tầng) và handler (tầng interface của module:
 * `modules/<x>/interface/consumers/`). Thuần kiểu — không import ioredis, để handler không kéo
 * client Redis vào chỉ vì cần kiểu của message.
 */
export interface StreamMessage {
  /** Id do Redis cấp. Đổi mỗi lần XADD — KHÔNG dùng làm khoá idempotent. */
  readonly id: string;
  readonly stream: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  /**
   * Khoá idempotent ỔN ĐỊNH của event: `outbox:<outbox_id>`. Relay XADD xong mà commit
   * `published_at` hỏng thì lần relay sau XADD lại — message id MỚI, nhưng khoá này vẫn CŨ,
   * nên consumer vẫn nhận ra là trùng.
   */
  readonly dedupKey: string;
  readonly occurredAt: Date;
  /** Lần giao thứ mấy (1 = lần đầu). */
  readonly deliveryCount: number;
}

/**
 * Chế độ mặc định (`idempotency: 'framework'`): handler chạy BÊN TRONG transaction của khung consumer
 * (cùng dấu processed_messages) — command gọi `uow.run` sẽ nhập vào đó; handler throw -> rollback cả hai.
 * Chế độ `'handler'`: không có transaction bao ngoài, handler tự chia transaction và tự khử trùng.
 */
export type MessageHandler = (message: StreamMessage) => Promise<void>;

/**
 * Lỗi mà thử lại bao nhiêu lần cũng không khỏi (payload sai hình dạng, tham chiếu không tồn tại).
 * Khung consumer đưa thẳng vào DLQ thay vì chờ hết số lần giao lại.
 */
export class PermanentMessageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentMessageError';
  }
}
