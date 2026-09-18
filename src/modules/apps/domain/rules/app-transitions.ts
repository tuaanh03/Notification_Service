import { InvalidTransitionError, type AppStatus } from '../../../../shared/kernel/index.ts';

/**
 * State machine của app — bản nhỏ, cùng cơ chế với notification (11 trạng thái).
 * Làm đúng ở đây trước, vì sai ở app thì hậu quả nhẹ hơn nhiều.
 */
export const APP_TRANSITIONS = {
  draft: { submit_for_review: 'pending_approval' },
  pending_approval: { approve: 'active', reject: 'draft' },
  active: { suspend: 'suspended', revoke: 'revoked' },
  suspended: { resume: 'active', revoke: 'revoked' },
  // revoked: không có dòng -> trạng thái kết thúc
} as const satisfies Partial<Record<AppStatus, Readonly<Record<string, AppStatus>>>>;

export type AppTransitionEvent =
  { [S in keyof typeof APP_TRANSITIONS]: keyof (typeof APP_TRANSITIONS)[S] }[keyof typeof APP_TRANSITIONS];

export function nextAppStatus(from: AppStatus, event: AppTransitionEvent): AppStatus {
  const row = (APP_TRANSITIONS as Partial<Record<AppStatus, Record<string, AppStatus>>>)[from];
  const next = row?.[event];
  if (!next) throw new InvalidTransitionError('App', from, event);
  return next;
}
