import { RateLimitedError, type AppId } from '../../../../shared/kernel/index.ts';
import { hourlyLimitFor, hourWindow } from '../../domain/rules/send-limits.ts';
import { paceLimitPerMinute, paceSlotTime } from '../../domain/rules/send-pacing.ts';
import { sendHoldUntil } from '../../domain/rules/send-window-hold.ts';
import type {
  IngressLimitsLookup,
  MailboxDayQuota,
  NotificationRepository,
  SendPolicyLookup,
  SendQuota,
  SendSlotReserver,
} from '../ports/index.ts';

/** Lúc gửi của MỘT thư: null = gửi ngay (`queued`); có giờ = `scheduled` tới lúc đó, kèm lý do để audit. */
export type SendTiming = { at: Date; reason: 'send_window' | 'pacing' | 'daily_cap' } | null;

/** Hàng chờ của app đầy (ADR-0041): app thử lại sau chừng này giây — hàng chờ vơi theo tốc độ gửi, không theo đồng hồ. */
const QUEUE_FULL_RETRY_SECONDS = 60;

export interface SendTimingDeps {
  policies: SendPolicyLookup;
  slots: SendSlotReserver;
  quota: SendQuota;
  mailbox: MailboxDayQuota;
  limits: IngressLimitsLookup;
  notifications: Pick<NotificationRepository, 'countPending'>;
}

/**
 * Lúc gửi của `count` thư cùng app, cùng topic nhận lúc `now` (ADR-0032, ADR-0041):
 *   1. hàng chờ của app (thư chưa xong) cộng `count` vượt `apps.max_pending_per_app` -> 429 `APP_QUEUE_FULL`;
 *   2. trần thư mỗi GIỜ của app (GĐ 3): cả `count` thư không vừa phần còn lại của giờ -> 429 `APP_HOURLY_LIMIT` (kèm
 *      Retry-After tới đầu giờ sau). Hai bước này KHÔNG nhận thư nào — phát vào topic không nhận một phần: nhận nửa danh
 *      sách là app không biết ai đã nhận;
 *   3. khung giờ: ngoài khung -> sớm nhất lúc khung mở (`sendHoldUntil`);
 *   4. dàn đều: từ mốc đó, mỗi thư giữ một lượt trong phút còn chỗ (`paceLimitPerMinute`), lượt chia đều trong phút;
 *   5. trần NGÀY của hộp gửi chung: mỗi thư giữ một lượt trong ngày; ngày đủ trần -> thư thường dời sang lúc khung giờ
 *      của app mở trong ngày còn chỗ (`daily_cap`). Tin bắt buộc vẫn đếm nhưng không bao giờ bị dời.
 * Lượt rơi vào lúc đã qua (đầu phút hiện tại) -> gửi ngay. Giữ lượt TRƯỚC transaction: transaction hỏng thì lượt đã giữ
 * bỏ phí — chỉ làm thư sau đi muộn hơn chút, không bao giờ vượt mức.
 */
export async function planSendTimes(
  deps: SendTimingDeps,
  appId: AppId,
  topic: { mandatory: boolean },
  now: Date,
  count: number,
): Promise<SendTiming[]> {
  const limits = await deps.limits.current();
  const pending = await deps.notifications.countPending(appId);
  if (pending + count > limits.maxPendingPerApp) {
    throw new RateLimitedError(
      'APP_QUEUE_FULL',
      `app already has ${pending} emails waiting to be sent (at most ${limits.maxPendingPerApp})`,
      QUEUE_FULL_RETRY_SECONDS,
    );
  }

  const policy = await deps.policies.forApp(appId);
  const perHour = hourlyLimitFor(policy, topic);
  if (perHour !== null && !(await deps.quota.takeHourly(appId, count, perHour, now))) {
    const retryAfterSeconds = (hourWindow(now).endMs - now.getTime()) / 1000;
    throw new RateLimitedError('APP_HOURLY_LIMIT', `app may accept at most ${perHour} emails per hour`, retryAfterSeconds);
  }
  const windowRule = { window: policy.window, mandatoryBypass: policy.mandatoryBypassWindow };
  const hold = sendHoldUntil(windowRule, topic, now);
  const limit = paceLimitPerMinute(policy, topic);

  let timings: SendTiming[];
  if (limit === null) {
    timings = Array.from({ length: count }, () => (hold ? { at: hold, reason: 'send_window' } : null));
  } else {
    const from = hold ?? now;
    const slots = await deps.slots.reserve(appId, limit, from, count);
    timings = slots.map((slot) => {
      const at = new Date(Math.max(paceSlotTime(slot, limit).getTime(), from.getTime()));
      if (at.getTime() <= now.getTime()) return null;
      return { at, reason: hold && at.getTime() === hold.getTime() ? 'send_window' : 'pacing' };
    });
  }

  const days = await deps.mailbox.reserve(timings[0]?.at ?? now, count, limits.mailboxDailyCap, topic.mandatory, now);
  return timings.map((timing, i) => {
    const day = days[i];
    const at = timing?.at ?? now;
    if (!day || day.getTime() <= at.getTime()) return timing;
    return { at: sendHoldUntil(windowRule, topic, day) ?? day, reason: 'daily_cap' };
  });
}

/**
 * ADR-0041: số lần gọi API gửi (`POST /v1/notifications`, `POST /v1/publications`) mỗi phút của app — `rate_limit_per_minute`
 * Super Admin đặt. Vượt -> 429 `APP_RATE_LIMITED`, Retry-After tới đầu phút sau. Đường gửi từ console không đi qua đây.
 */
export async function takeApiCall(quota: SendQuota, appId: AppId, limitPerMinute: number, now: Date): Promise<void> {
  if (await quota.takeApiCall(appId, limitPerMinute, now)) return;
  const retryAfterSeconds = (60_000 - (now.getTime() % 60_000)) / 1000;
  throw new RateLimitedError('APP_RATE_LIMITED', `app may call the send API at most ${limitPerMinute} times per minute`, retryAfterSeconds);
}

/** Phần audit của thư phải chờ: giờ gửi + lý do. Gửi ngay -> rỗng. */
export const scheduleNote = (timing: SendTiming): Record<string, string> =>
  timing ? { scheduledAt: timing.at.toISOString(), reason: timing.reason } : {};
