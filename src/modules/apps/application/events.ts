/**
 * Tên event của module apps. Hiện mọi event chỉ vào `audit.events` (routeEvent mặc định); event nào
 * cần worker xử lý thì thêm vào EVENT_ROUTES ở `shared/streams/names.ts`.
 */
export const APP_EVENTS = {
  created: 'AppCreated',
  submittedForReview: 'AppSubmittedForReview',
  approved: 'AppApproved',
  rejected: 'AppRejected',
  suspended: 'AppSuspended',
  resumed: 'AppResumed',
  revoked: 'AppRevoked',
  secretIssued: 'AppSecretIssued',
  secretRevoked: 'AppSecretRevoked',
  networkRuleAdded: 'AppNetworkRuleAdded',
  networkRuleRemoved: 'AppNetworkRuleRemoved',
} as const;

export const APP_AGGREGATE = 'App';
