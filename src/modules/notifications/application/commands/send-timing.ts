import type { AppId } from '../../../../shared/kernel/index.ts';
import { paceLimitPerMinute, paceSlotTime } from '../../domain/rules/send-pacing.ts';
import { sendHoldUntil } from '../../domain/rules/send-window-hold.ts';
import type { SendPolicyLookup, SendSlotReserver } from '../ports/index.ts';

/** Lúc gửi của MỘT thư: null = gửi ngay (`queued`); có giờ = `scheduled` tới lúc đó, kèm lý do để audit. */
export type SendTiming = { at: Date; reason: 'send_window' | 'pacing' } | null;

/**
 * Lúc gửi của `count` thư cùng app, cùng topic nhận lúc `now` (ADR-0032):
 *   1. khung giờ: ngoài khung -> sớm nhất lúc khung mở (`sendHoldUntil`);
 *   2. dàn đều: từ mốc đó, mỗi thư giữ một lượt trong phút còn chỗ (`paceLimitPerMinute`), lượt chia đều trong phút.
 * Lượt rơi vào lúc đã qua (đầu phút hiện tại) -> gửi ngay. Giữ lượt TRƯỚC transaction: transaction hỏng thì
 * lượt đã giữ bỏ phí — chỉ làm thư sau đi muộn hơn chút, không bao giờ vượt mức.
 */
export async function planSendTimes(
  deps: { policies: SendPolicyLookup; slots: SendSlotReserver },
  appId: AppId,
  topic: { mandatory: boolean },
  now: Date,
  count: number,
): Promise<SendTiming[]> {
  const policy = await deps.policies.forApp(appId);
  const hold = sendHoldUntil({ window: policy.window, mandatoryBypass: policy.mandatoryBypassWindow }, topic, now);
  const limit = paceLimitPerMinute(policy, topic);
  if (limit === null) return Array.from({ length: count }, () => (hold ? { at: hold, reason: 'send_window' } : null));

  const from = hold ?? now;
  const slots = await deps.slots.reserve(appId, limit, from, count);
  return slots.map((slot) => {
    const at = new Date(Math.max(paceSlotTime(slot, limit).getTime(), from.getTime()));
    if (at.getTime() <= now.getTime()) return null;
    return { at, reason: hold && at.getTime() === hold.getTime() ? 'send_window' : 'pacing' };
  });
}

/** Phần audit của thư phải chờ: giờ gửi + lý do. Gửi ngay -> rỗng. */
export const scheduleNote = (timing: SendTiming): Record<string, string> =>
  timing ? { scheduledAt: timing.at.toISOString(), reason: timing.reason } : {};
