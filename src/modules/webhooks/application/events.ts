export const WEBHOOK_ENDPOINT_AGGREGATE = 'WebhookEndpoint';

/** Chỉ vào `audit.events`. Từng lượt gọi không audit — nhật ký nằm ở `webhook_deliveries`. */
export const WEBHOOK_EVENTS = {
  created: 'WebhookEndpointCreated',
  updated: 'WebhookEndpointUpdated',
  secretRotated: 'WebhookSecretRotated',
  deleted: 'WebhookEndpointDeleted',
} as const;

/** Event của notifications -> loại sự kiện webhook gửi cho app. */
export const NOTIFICATION_EVENT_TO_WEBHOOK = {
  NotificationSent: 'notification.sent',
  NotificationFailed: 'notification.failed',
  NotificationNoRecipient: 'notification.no_recipient',
} as const;
