import type { Subscription } from '../domain/entities/subscription.ts';

/**
 * Email của một user nhìn từ ngoài module. KHÔNG có `manage_token` — token chỉ đi vào link trong
 * email, không trả qua API cho app service.
 */
export interface EmailSubscriptionDto {
  subscriptionId: string;
  address: string;
  /** active | unsubscribed | invalid */
  status: string;
  /** user_unsubscribe | hard_bounce | complaint | null */
  suppressedReason: string | null;
  optedOutOptional: boolean;
}

export const toEmailSubscriptionDto = (s: Subscription): EmailSubscriptionDto => ({
  subscriptionId: s.id,
  address: s.value,
  status: s.status,
  suppressedReason: s.suppressedReason,
  optedOutOptional: s.optedOutOptional,
});
