/**
 * Lịch gọi lại khi app không trả 2xx (ADR-0029 §5): lần 1 ngay, rồi chờ 1 phút · 5 phút · 30 phút · 2 giờ
 * · 6 giờ. Hết 6 lần -> `failed`, không gọi nữa.
 */
export const WEBHOOK_RETRY_DELAYS_MS: readonly number[] = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

/** `attempts` = số lần ĐÃ gọi (kể cả lần vừa lỗi). null = hết lượt. */
export function nextAttemptAt(attempts: number, at: Date): Date | null {
  const delay = WEBHOOK_RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(at.getTime() + delay);
}
