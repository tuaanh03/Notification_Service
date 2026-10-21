/** Giới hạn gửi GĐ 3 của một app (ADR-0032), tra từ module apps. */
export interface SendLimitsPolicy {
  /** Trần thư mỗi giờ (Super Admin). null = không trần. */
  maxPerHour: number | null;
  /** Tin bắt buộc được vượt trần mỗi giờ (Super Admin bật). */
  mandatoryBypassHourly: boolean;
  /** Mỗi người nhận tối đa N thư / ngày (Admin App). null = không giới hạn. */
  recipientDailyLimit: number | null;
  /** Tin bắt buộc không tính vào giới hạn mỗi người. */
  mandatoryBypassRecipientLimit: boolean;
}

/** Trần mỗi giờ áp cho thư của topic này; null = không áp. */
export function hourlyLimitFor(policy: SendLimitsPolicy, topic: { mandatory: boolean }): number | null {
  if (policy.maxPerHour === null) return null;
  return topic.mandatory && policy.mandatoryBypassHourly ? null : policy.maxPerHour;
}

/** Giới hạn mỗi người / ngày áp cho thư của topic này; null = không áp. */
export function recipientLimitFor(policy: SendLimitsPolicy, topic: { mandatory: boolean }): number | null {
  if (policy.recipientDailyLimit === null) return null;
  return topic.mandatory && policy.mandatoryBypassRecipientLimit ? null : policy.recipientDailyLimit;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Giờ Việt Nam cố định UTC+7, không giờ mùa hè (cùng quy ước khung giờ gửi — ADR-0032 GĐ 1). */
const VN_OFFSET_MS = 7 * HOUR_MS;

/** Khung giờ chứa `now` (giờ tròn — giống nhau ở mọi múi giờ lệch nguyên giờ). */
export function hourWindow(now: Date): { startMs: number; endMs: number } {
  const startMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return { startMs, endMs: startMs + HOUR_MS };
}

/** Ngày THEO GIỜ VIỆT NAM chứa `now` — "mỗi ngày" với người dùng là từ 0 giờ tới 24 giờ ở Việt Nam. */
export function vnDayWindow(now: Date): { startMs: number; endMs: number } {
  const startMs = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  return { startMs, endMs: startMs + DAY_MS };
}
