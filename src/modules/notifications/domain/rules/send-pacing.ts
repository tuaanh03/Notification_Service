/** Chính sách dàn đều của một app (ADR-0032 GĐ 2), tra từ module apps. */
export interface PacingPolicy {
  /** Admin App đặt: tối đa N thư / phút. null = không dàn. */
  perMinute: number | null;
  /** Tin bắt buộc không bị dàn theo `perMinute`. */
  mandatoryBypassPacing: boolean;
  /** Trần Super Admin đặt — áp cho MỌI thư, kể cả tin bắt buộc. null = không trần riêng. */
  maxPerMinute: number | null;
}

/**
 * Số thư / phút áp cho một thư của topic này. null = không dàn (chỉ còn giới hạn chung của hộp gửi).
 *   - thư thường: số nhỏ hơn giữa mức app đặt và trần;
 *   - tin bắt buộc + app cho bỏ qua: chỉ trần. Cùng đếm chung một chỗ với thư thường, nên khi mức app đặt
 *     thấp hơn trần, phần chênh còn trống mỗi phút là chỗ tin bắt buộc chen lên trước.
 */
export function paceLimitPerMinute(policy: PacingPolicy, topic: { mandatory: boolean }): number | null {
  const own = topic.mandatory && policy.mandatoryBypassPacing ? null : policy.perMinute;
  if (own === null) return policy.maxPerMinute;
  if (policy.maxPerMinute === null) return own;
  return Math.min(own, policy.maxPerMinute);
}

const MINUTE_MS = 60_000;

/** Lượt thứ `index` của phút `minute` gửi lúc nào: chia đều trong phút, không dồn ở giây đầu. */
export function paceSlotTime(slot: { minute: number; index: number }, limitPerMinute: number): Date {
  return new Date(slot.minute * MINUTE_MS + Math.floor((slot.index * MINUTE_MS) / limitPerMinute));
}
