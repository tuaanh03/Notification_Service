import type { UserId } from '../../../../shared/kernel/index.ts';
import { emailGate, type EmailGateInput } from './email-gate.ts';

export interface AudienceCandidate {
  userId: UserId;
  /** Email của user trong app; null = chưa có email. */
  subscription: EmailGateInput['subscription'];
  /** Lựa chọn của user cho topic; null = chưa chọn, theo `defaultMode`. */
  preference: { optedIn: boolean } | null;
}

/**
 * Người nhận của MỘT lần phát tin vào topic (ADR-0028): những user mà `emailGate` cho qua — đúng cổng
 * worker chạy lại ngay trước lúc gửi từng thư con, nên danh sách chốt lúc phát và lúc gửi không thể lệch
 * luật (chỉ lệch dữ liệu, nếu user đổi ý ở giữa — khi đó worker chặn, như thư lẻ).
 *
 * Không dùng `resolveRecipients` của segments: phát trong MỘT app, không segment, gộp theo user — pipeline
 * khi đó trùng đúng `emailGate` từng user, mà kéo segments vào notifications là thêm một ngoại lệ phụ thuộc.
 *
 * Trả theo `userId` tăng dần — kết quả không phụ thuộc thứ tự SQL trả về.
 */
export function selectTopicAudience(candidates: readonly AudienceCandidate[], topic: EmailGateInput['topic']): UserId[] {
  return candidates
    .filter((c) => emailGate({ subscription: c.subscription, topic, preference: c.preference }).allowed)
    .map((c) => c.userId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
