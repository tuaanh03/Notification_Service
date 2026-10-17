import { ValidationError, issue, type Issue } from './errors.ts';

/**
 * Khung giờ gửi của một app (ADR-0032): những ngày trong tuần + giờ bắt đầu / kết thúc, theo GIỜ VIỆT NAM.
 * Đặt ở kernel vì hai module cùng dùng: `apps` kiểm và lưu, `notifications` tính "gửi sớm nhất lúc".
 *
 * Giờ Việt Nam cố định UTC+7, không có giờ mùa hè — cộng hằng số là đủ, không cần dữ liệu múi giờ.
 */
export const SEND_WINDOW_UTC_OFFSET_MINUTES = 7 * 60;

/** 1 = thứ Hai … 7 = Chủ nhật (ISO 8601). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SendWindow {
  /** Sắp tăng dần, không trùng, ít nhất một ngày. */
  days: readonly IsoWeekday[];
  /** `HH:MM`, 00:00 – 23:59. */
  start: string;
  /** `HH:MM`, sau `start`; `24:00` = tới hết ngày. Mốc kết thúc KHÔNG nằm trong khung. */
  end: string;
}

const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Kiểm + chuẩn hoá khung giờ. Sai -> ValidationError:
 *   SEND_WINDOW_DAYS_REQUIRED · SEND_WINDOW_DAY_INVALID · SEND_WINDOW_TIME_INVALID · SEND_WINDOW_EMPTY (bắt đầu ≥ kết thúc).
 * Khung qua nửa đêm (22:00 → 06:00) chưa hỗ trợ — tin cần gửi ban đêm là tin bắt buộc, đã có ngoại lệ.
 */
export function parseSendWindow(input: { days: readonly number[]; start: string; end: string }): SendWindow {
  const issues: Issue[] = [];
  if (input.days.length === 0) issues.push(issue('SEND_WINDOW_DAYS_REQUIRED', 'choose at least one day', 'days'));
  if (input.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    issues.push(issue('SEND_WINDOW_DAY_INVALID', 'days must be 1 (Monday) to 7 (Sunday)', 'days'));
  }
  if (!START.test(input.start)) issues.push(issue('SEND_WINDOW_TIME_INVALID', 'start must be HH:MM', 'start'));
  if (!END.test(input.end)) issues.push(issue('SEND_WINDOW_TIME_INVALID', 'end must be HH:MM or 24:00', 'end'));
  if (issues.length) throw new ValidationError(issues);
  if (minutesOf(input.start) >= minutesOf(input.end)) {
    throw ValidationError.of('SEND_WINDOW_EMPTY', 'start must be before end', 'end');
  }
  const days = [...new Set(input.days)].sort((a, b) => a - b) as IsoWeekday[];
  return { days, start: input.start, end: input.end };
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * Mốc sớm nhất được gửi tính từ `now`: đang trong khung -> chính `now`; ngoài khung -> lúc khung mở tiếp theo (UTC).
 * Luôn có kết quả trong vòng 7 ngày vì khung có ít nhất một ngày.
 */
export function nextSendOpening(window: SendWindow, now: Date): Date {
  const offsetMs = SEND_WINDOW_UTC_OFFSET_MINUTES * MINUTE_MS;
  // "Giờ địa phương" biểu diễn bằng Date dịch đi +7h rồi đọc bằng getUTC*.
  const local = new Date(now.getTime() + offsetMs);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = minutesOf(window.start) * MINUTE_MS;
  const end = minutesOf(window.end) * MINUTE_MS;
  for (let d = 0; d <= 7; d += 1) {
    const dayStart = midnight + d * DAY_MS;
    const weekday = (((new Date(dayStart).getUTCDay() + 6) % 7) + 1) as IsoWeekday;
    if (!window.days.includes(weekday)) continue;
    if (local.getTime() >= dayStart + end) continue;
    if (local.getTime() >= dayStart + start) return now;
    return new Date(dayStart + start - offsetMs);
  }
  throw new Error('send window has no day'); // parseSendWindow đã chặn — không tới được
}
