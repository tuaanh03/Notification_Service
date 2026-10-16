import { NotificationId, type Clock } from '../../../../shared/kernel/index.ts';
import type { OpenTrackingSigner, RecipientRepository } from '../ports/index.ts';

/**
 * `GET /t/o/:notificationId/:sig.gif` — ứng dụng mail tải ảnh theo dõi (ADR-0031). Chữ ký sai, id lạ,
 * thư chưa `sent` -> không ghi gì; route vẫn trả ảnh như thường để không lộ URL nào là thật.
 * Không event, không audit: một lượt mở không phải hành động quản trị, và mỗi thư có thể có nhiều lượt.
 */
export class RecordEmailOpen {
  private readonly deps: { clock: Clock; signer: OpenTrackingSigner; recipients: RecipientRepository };

  constructor(deps: RecordEmailOpen['deps']) {
    this.deps = deps;
  }

  async execute(input: { notificationId: string; signature: string }): Promise<boolean> {
    const { clock, signer, recipients } = this.deps;
    if (!signer.configured || !NotificationId.is(input.notificationId)) return false;
    const id = NotificationId.parse(input.notificationId);
    if (!signer.verify(id, input.signature)) return false;
    return recipients.recordOpen(id, clock.now());
  }
}
