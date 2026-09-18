import type {
  ExclusionReason,
  SubscriptionStatus,
  SuppressedReason,
} from '../../../shared/kernel/index.ts';

/**
 * Trạng thái tối thiểu để quyết định một subscription có nhận được tin hay không.
 * Cả entity Subscription lẫn pipeline giải người nhận đều dùng hàm dưới đây —
 * rule opt-out chỉ được viết MỘT lần, ở đây.
 */
export interface SubscriptionGateState {
  status: SubscriptionStatus;
  suppressedReason: SuppressedReason | null;
  optedOutOptional: boolean;
}

export type GateResult = { allowed: true } | { allowed: false; reason: ExclusionReason };

const ALLOWED: GateResult = { allowed: true };

/**
 * Hai lớp lọc đầu tiên, theo đúng thứ tự và đúng ngoại lệ:
 *
 *  L0 — kênh còn sống không? KHÔNG BAO GIỜ bỏ qua, kể cả topic mandatory.
 *       Kênh chết (hard bounce / complaint / user ngắt hẳn) là chết với mọi loại tin.
 *  L1 — user đã tắt mọi tin không bắt buộc chưa? BỎ QUA nếu topic mandatory.
 *
 * Gộp hai khái niệm này vào một cờ chính là lỗi khiến tin mandatory bị chặn oan.
 */
export function channelGate(
  state: SubscriptionGateState,
  opts: { topicMandatory: boolean },
): GateResult {
  // L0
  if (state.status === 'invalid') return { allowed: false, reason: 'invalid' };
  if (state.status === 'unsubscribed') return { allowed: false, reason: 'suppressed' };
  if (state.suppressedReason !== null) return { allowed: false, reason: 'suppressed' };

  // L1
  if (state.optedOutOptional && !opts.topicMandatory) {
    return { allowed: false, reason: 'opted_out_optional' };
  }

  return ALLOWED;
}
