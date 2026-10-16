/**
 * Nguồn duy nhất cho mọi enum: DB (mysqlEnum), validate biên và frontend đều import từ đây.
 * Khai bằng mảng `as const` để vừa suy ra union type, vừa đưa thẳng vào mysqlEnum().
 */

/** 11 trạng thái notification — SM §3. Thứ tự giữ nguyên, frontend map theo tên. */
export const NOTIFICATION_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'partially_failed',
  'no_recipient',
  'stopped',
  'cancelled',
  'failed',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** 6 trạng thái kết thúc: không có đường ra (SM-2). */
export const TERMINAL_STATUSES = [
  'sent',
  'partially_failed',
  'no_recipient',
  'stopped',
  'cancelled',
  'failed',
] as const satisfies readonly NotificationStatus[];
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const NOTIFICATION_ORIGINS = ['api', 'dashboard'] as const;
export type NotificationOrigin = (typeof NOTIFICATION_ORIGINS)[number];

/** Duyệt gửi khi vượt ngưỡng (`pending_approval`) — Super Admin quyết. */
export const SEND_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SendApprovalStatus = (typeof SEND_APPROVAL_STATUSES)[number];

export const APP_STATUSES = ['draft', 'pending_approval', 'active', 'suspended', 'revoked'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const APP_ORIGINS = ['internal', 'external'] as const;
export type AppOrigin = (typeof APP_ORIGINS)[number];

export const APP_SECRET_STATUSES = ['active', 'revoked'] as const;
export type AppSecretStatus = (typeof APP_SECRET_STATUSES)[number];

/** Allowlist của app: địa chỉ IP gọi `/v1/*` hoặc origin của trình duyệt. */
export const NETWORK_RULE_KINDS = ['ip'] as const;
export type NetworkRuleKind = (typeof NETWORK_RULE_KINDS)[number];

export const CHANNELS = ['email', 'sms', 'push', 'in_app'] as const;
export type Channel = (typeof CHANNELS)[number];

/** unsubscribed ≠ invalid (UC-007 BR-9): hard bounce đi vào `invalid`, không bao giờ `unsubscribed`. */
export const SUBSCRIPTION_STATUSES = ['active', 'unsubscribed', 'invalid'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUPPRESSED_REASONS = ['user_unsubscribe', 'hard_bounce', 'complaint'] as const;
export type SuppressedReason = (typeof SUPPRESSED_REASONS)[number];

export const TOPIC_DEFAULT_MODES = ['opt_in', 'opt_out'] as const;
export type TopicDefaultMode = (typeof TOPIC_DEFAULT_MODES)[number];

export const TOPIC_STATUSES = ['draft', 'active', 'suspended'] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const PREFERENCE_SOURCES = [
  'user_explicit',
  'system_default',
  'admin_override',
  'bulk_opt_out',
] as const;
export type PreferenceSource = (typeof PREFERENCE_SOURCES)[number];

/**
 * Vai trò trên TOÀN HỆ THỐNG (cột `admins.role`, ADR-0022). Chỉ Super Admin có quyền hệ thống;
 * mọi người khác là `user` — quyền của họ đến từ vai trong org (`ORG_ROLES`) và trong app (`APP_ROLES`).
 */
export const ADMIN_ROLES = ['super_admin', 'user'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Vai trong một org (`org_members.role`), cao xuống thấp. Org luôn còn ít nhất một `owner`. */
export const ORG_ROLES = ['owner', 'org_admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Vai trên một app (`admin_app_roles.role`) — chỉ cấp được cho thành viên của org sở hữu app. */
export const APP_ROLES = ['app_admin', 'app_viewer'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** `console` = người quản lý app thêm tay trên console; `api` = app đẩy vào qua `/v1`. */
export const USER_SOURCES = ['directory', 'import', 'self', 'api', 'console'] as const;
export type UserSource = (typeof USER_SOURCES)[number];

export const TEMPLATE_STATUSES = ['active', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

/** Biến template chỉ được lấy từ hai nguồn — trộn cú pháp là lỗi khó thấy (OneSignal §2.1). */
export const VARIABLE_SOURCES = ['payload', 'user'] as const;
export type VariableSource = (typeof VARIABLE_SOURCES)[number];

/** Lý do một người bị loại khỏi danh sách nhận — ghi vào notification_recipients. */
export const EXCLUSION_REASONS = [
  'duplicate',
  'no_channel',
  'invalid',
  'suppressed',
  'opted_out_optional',
  'excluded',
  'opted_out',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const RECIPIENT_STATUSES = ['pending', 'sent', 'bounced', 'failed', 'skipped'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const DELIVERY_BATCH_STATUSES = ['pending', 'sending', 'done', 'failed', 'skipped'] as const;
export type DeliveryBatchStatus = (typeof DELIVERY_BATCH_STATUSES)[number];

export const BOUNCE_KINDS = ['hard', 'soft'] as const;
export type BounceKind = (typeof BOUNCE_KINDS)[number];

/**
 * Sự kiện app đăng ký nhận qua outgoing webhook (ADR-0029). `ping` chỉ dùng cho nút "Gửi thử" — không
 * đăng ký được.
 */
export const WEBHOOK_EVENT_TYPES = ['notification.sent', 'notification.failed', 'notification.no_recipient', 'notification.opened'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_ENDPOINT_STATUSES = ['active', 'disabled'] as const;
export type WebhookEndpointStatus = (typeof WEBHOOK_ENDPOINT_STATUSES)[number];

/** pending = còn lượt gọi (kể cả đang chờ lượt sau) · delivered = app trả 2xx · failed = hết lượt / URL bị tắt. */
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/** Incoming webhook (ADR-0030): hook tắt thì URL trả 404 như không tồn tại. */
export const INCOMING_HOOK_STATUSES = ['active', 'disabled'] as const;
export type IncomingHookStatus = (typeof INCOMING_HOOK_STATUSES)[number];

/** Kết cục một lần công cụ ngoài gọi vào hook — cột `outcome` của nhật ký gọi. */
export const INCOMING_CALL_OUTCOMES = ['published', 'duplicate', 'skipped', 'rejected'] as const;
export type IncomingCallOutcome = (typeof INCOMING_CALL_OUTCOMES)[number];

export const ACTOR_TYPES = ['admin', 'app', 'user', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Identity Resolver chỉ merge bằng khoá xác thực — không bao giờ probabilistic. */
export const MATCHED_ON = ['email', 'phone', 'admin_manual'] as const;
export type MatchedOn = (typeof MATCHED_ON)[number];
