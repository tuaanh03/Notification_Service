import type { ExclusionReason } from '../../../../shared/kernel/index.ts';
import { channelGate, type SubscriptionGateState } from '../../../subscriptions/domain/rules/subscription-gate.ts';
import { effectiveOptIn, type ConsentTopic } from '../../../topics/domain/rules/topic-consent.ts';

/**
 * Cổng consent cho MỘT người nhận của email gửi trực tiếp (MVP — ADR-0016). Chỉ GHÉP hai rule có sẵn,
 * không viết lại điều kiện nào (ADR-0010):
 *
 *   không có email            -> no_channel
 *   L0 + L1  channelGate      -> invalid / suppressed / opted_out_optional
 *   L3       effectiveOptIn   -> opted_out
 *
 * Ngoại lệ mandatory nằm TRONG hai hàm đó: mandatory bỏ qua L1 và L3, KHÔNG BAO GIỜ bỏ qua L0.
 */
export interface EmailGateInput {
  /** Email của user trong app; null = user chưa có email. */
  subscription: SubscriptionGateState | null;
  topic: ConsentTopic;
  /** Lựa chọn của user cho topic; null = chưa chọn, theo `defaultMode`. */
  preference: { optedIn: boolean } | null;
}

export type EmailGateResult = { allowed: true } | { allowed: false; reason: ExclusionReason };

export function emailGate(input: EmailGateInput): EmailGateResult {
  if (input.subscription === null) return { allowed: false, reason: 'no_channel' };
  const channel = channelGate(input.subscription, { topicMandatory: input.topic.mandatory });
  if (!channel.allowed) return channel;
  if (!effectiveOptIn(input.topic, input.preference)) return { allowed: false, reason: 'opted_out' };
  return { allowed: true };
}
