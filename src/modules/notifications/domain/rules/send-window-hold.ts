import { nextSendOpening, type SendWindow } from '../../../../shared/kernel/index.ts';

/**
 * Thư nhận lúc `now` phải chờ tới khi nào (ADR-0032). null = gửi ngay.
 *   - app không đặt khung giờ -> gửi ngay;
 *   - topic bắt buộc + app cho tin bắt buộc bỏ qua khung -> gửi ngay;
 *   - đang trong khung -> gửi ngay; ngoài khung -> lúc khung mở tiếp theo.
 */
export function sendHoldUntil(
  policy: { window: SendWindow | null; mandatoryBypass: boolean },
  topic: { mandatory: boolean },
  now: Date,
): Date | null {
  if (policy.window === null) return null;
  if (topic.mandatory && policy.mandatoryBypass) return null;
  const opening = nextSendOpening(policy.window, now);
  return opening.getTime() > now.getTime() ? opening : null;
}
