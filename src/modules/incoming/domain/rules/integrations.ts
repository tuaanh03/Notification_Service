import { ValidationError } from '../../../../shared/kernel/index.ts';
import type { PublishCondition, TemplateVariable, VariableMapping } from '../types/hook-config.ts';

/** Công cụ giám sát cắm thẳng vào incoming webhook (ADR-0046). Thêm công cụ = thêm một dòng ở đây. */
export const INCOMING_INTEGRATION_IDS = ['generic', 'datadog', 'grafana', 'alertmanager', 'gatus', 'uptime-kuma'] as const;
export type IncomingIntegrationId = (typeof INCOMING_INTEGRATION_IDS)[number];

/** Phát khi nào: đang lỗi · đã khắc phục · cả hai. */
export const ALERT_TRIGGERS = ['firing', 'resolved', 'all'] as const;
export type AlertTrigger = (typeof ALERT_TRIGGERS)[number];

/**
 * generic = trường cùng tên biến (ADR-0030) · custom = công cụ cho tự viết body, danh mục giữ TOKEN của công cụ
 * · fixed = công cụ gửi JSON cố định, danh mục giữ ĐƯỜNG DẪN JSON (cú pháp `json-path.ts`).
 */
export type IntegrationPayload = 'generic' | 'custom' | 'fixed';

export interface IntegrationField {
  /** Tên biến KHÔNG có tiền tố `payload.` — khoá của template alert dựng sẵn (ADR-0035). */
  variable: string;
  /** custom: token công cụ thay vào body · fixed: đường dẫn JSON. */
  source: string;
}

export interface IntegrationStatus {
  /** custom: tên trường EWS thêm vào body mẫu · fixed: trùng `source` (đường dẫn trong JSON của công cụ). */
  field: string;
  /** custom: token trạng thái · fixed: đường dẫn JSON. */
  source: string;
  firing: string[];
  resolved: string[];
}

export interface IncomingIntegration {
  id: IncomingIntegrationId;
  name: string;
  payload: IntegrationPayload;
  docsUrl: string | null;
  fields: readonly IntegrationField[];
  status: IntegrationStatus | null;
  steps: { vi: readonly string[]; en: readonly string[] };
  /**
   * Giá trị khi công cụ không gửi / gửi rỗng (nhãn tuỳ chọn như `severity`, mô tả bỏ trống) — vào `defaultValue`
   * của ánh xạ để biến bắt buộc của template alert không làm hỏng cả lần gọi. Không có trong DTO.
   */
  fallbacks?: Readonly<Record<string, string>> | undefined;
}

/** Trường trạng thái EWS thêm vào body mẫu của công cụ `custom` — điều kiện phát đọc trường này. */
export const CUSTOM_STATUS_FIELD = 'alert_status';

/** Giá trị khi công cụ không có nhãn / mô tả — trung tính, không phụ thuộc ngôn ngữ thư. */
const NOT_PROVIDED = '—';

/*
 * Nguồn của từng token / đường dẫn (tra 2026-10-23):
 *  - Datadog: https://docs.datadoghq.com/integrations/webhooks/ — `$ALERT_TRANSITION` = Triggered / Re-Triggered /
 *    Recovered / Warn / Re-Warn / No Data / Re-No Data / Renotify; `$DATE` = epoch mili-giây; `$ALERT_TYPE` =
 *    error / warning / success / info (luôn có — `$ALERT_PRIORITY` rỗng khi monitor không đặt mức ưu tiên).
 *  - Grafana: webhook-notifier — `status` = firing / resolved; mỗi alert có labels / annotations / startsAt /
 *    endsAt / generatorURL. Alertmanager: webhook_config — cùng khung (status, alerts[].…, payload version 4).
 *    Lấy `alerts[0]` (luôn có) thay vì `commonLabels` (thiếu khi nhóm có nhiều alertname).
 *  - Gatus: README "Configuring custom alerts" — [ENDPOINT_NAME], [ENDPOINT_URL], [ALERT_DESCRIPTION],
 *    [ALERT_TRIGGERED_OR_RESOLVED] = TRIGGERED / RESOLVED (cần send-on-resolved; đổi được bằng `placeholders`).
 *    Không có placeholder thời điểm / mức độ -> biến đó dùng giá trị mẫu.
 *  - Uptime Kuma: notification-provider.js `renderTemplate` (Liquid, ngữ cảnh msg / monitorJSON / heartbeatJSON);
 *    heartbeat status 0 = DOWN, 1 = UP (2 PENDING, 3 MAINTENANCE); monitor.js thêm `heartbeatJSON.localDateTime`
 *    (giờ theo múi của Kuma) và đổi `msg` rỗng thành "N/A".
 */
export const INCOMING_INTEGRATIONS: readonly IncomingIntegration[] = [
  {
    id: 'generic',
    name: 'JSON',
    payload: 'generic',
    docsUrl: null,
    fields: [],
    status: null,
    steps: {
      vi: ['Gửi POST, Content-Type: application/json, tới URL của EWS', 'Body có trường trùng tên biến của template'],
      en: ['Send a POST with Content-Type: application/json to the EWS URL', 'Use body fields named after the template variables'],
    },
  },
  {
    id: 'datadog',
    name: 'Datadog',
    payload: 'custom',
    docsUrl: 'https://docs.datadoghq.com/integrations/webhooks/',
    fields: [
      { variable: 'incident_title', source: '$EVENT_TITLE' },
      { variable: 'severity', source: '$ALERT_TYPE' },
      { variable: 'started_at', source: '$DATE' },
      { variable: 'detail_url', source: '$LINK' },
      { variable: 'resolved_at', source: '$DATE' },
      { variable: 'summary', source: '$TEXT_ONLY_MSG' },
    ],
    status: { field: CUSTOM_STATUS_FIELD, source: '$ALERT_TRANSITION', firing: ['Triggered', 'Re-Triggered'], resolved: ['Recovered'] },
    steps: {
      vi: [
        'Integrations → Webhooks → New: dán URL của EWS',
        'Bật Custom Payload, dán body mẫu bên dưới',
        'Trong monitor, thêm @webhook-<tên> vào nội dung thông báo',
      ],
      en: [
        'Integrations → Webhooks → New: paste the EWS URL',
        'Turn on Custom Payload and paste the sample body below',
        'In the monitor message, mention @webhook-<name>',
      ],
    },
    fallbacks: { summary: NOT_PROVIDED },
  },
  {
    id: 'grafana',
    name: 'Grafana',
    payload: 'fixed',
    docsUrl: 'https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/',
    fields: [
      { variable: 'incident_title', source: 'alerts[0].labels.alertname' },
      { variable: 'severity', source: 'alerts[0].labels.severity' },
      { variable: 'started_at', source: 'alerts[0].startsAt' },
      { variable: 'detail_url', source: 'alerts[0].generatorURL' },
      { variable: 'resolved_at', source: 'alerts[0].endsAt' },
      { variable: 'summary', source: 'alerts[0].annotations.summary' },
    ],
    status: { field: 'status', source: 'status', firing: ['firing'], resolved: ['resolved'] },
    steps: {
      vi: [
        'Alerting → Contact points → Add contact point',
        'Integration: Webhook, URL: dán URL của EWS, lưu',
        'Notification policies: chuyển cảnh báo tới contact point này',
      ],
      en: [
        'Alerting → Contact points → Add contact point',
        'Integration: Webhook, URL: paste the EWS URL, save',
        'Notification policies: route alerts to this contact point',
      ],
    },
    fallbacks: { severity: NOT_PROVIDED, summary: NOT_PROVIDED },
  },
  {
    id: 'alertmanager',
    name: 'Prometheus Alertmanager',
    payload: 'fixed',
    docsUrl: 'https://prometheus.io/docs/alerting/latest/configuration/#webhook_config',
    fields: [
      { variable: 'incident_title', source: 'alerts[0].labels.alertname' },
      { variable: 'severity', source: 'alerts[0].labels.severity' },
      { variable: 'started_at', source: 'alerts[0].startsAt' },
      { variable: 'detail_url', source: 'alerts[0].generatorURL' },
      { variable: 'resolved_at', source: 'alerts[0].endsAt' },
      { variable: 'summary', source: 'alerts[0].annotations.summary' },
    ],
    status: { field: 'status', source: 'status', firing: ['firing'], resolved: ['resolved'] },
    steps: {
      vi: [
        'Thêm receiver có webhook_configs, url: URL của EWS',
        'Đặt send_resolved: true để báo khi đã khắc phục',
        'Gắn receiver vào route rồi tải lại Alertmanager',
      ],
      en: [
        'Add a receiver with webhook_configs, url: the EWS URL',
        'Set send_resolved: true to get resolved notices',
        'Point a route at the receiver and reload Alertmanager',
      ],
    },
    fallbacks: { severity: NOT_PROVIDED, summary: NOT_PROVIDED },
  },
  {
    id: 'gatus',
    name: 'Gatus',
    payload: 'custom',
    docsUrl: 'https://github.com/TwiN/gatus#configuring-custom-alerts',
    fields: [
      { variable: 'incident_title', source: '[ENDPOINT_NAME]' },
      { variable: 'detail_url', source: '[ENDPOINT_URL]' },
      { variable: 'summary', source: '[ALERT_DESCRIPTION]' },
    ],
    status: { field: CUSTOM_STATUS_FIELD, source: '[ALERT_TRIGGERED_OR_RESOLVED]', firing: ['TRIGGERED'], resolved: ['RESOLVED'] },
    steps: {
      vi: [
        'alerting.custom: url là URL của EWS, method: POST',
        'headers: Content-Type: application/json',
        'body: dán body mẫu bên dưới',
        'Endpoint: alerts type custom, send-on-resolved: true',
      ],
      en: [
        'alerting.custom: url is the EWS URL, method: POST',
        'headers: Content-Type: application/json',
        'body: paste the sample body below',
        'Endpoint: alerts of type custom, send-on-resolved: true',
      ],
    },
    fallbacks: { summary: NOT_PROVIDED },
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    payload: 'custom',
    docsUrl: 'https://github.com/louislam/uptime-kuma/wiki/Notification-Methods',
    fields: [
      { variable: 'incident_title', source: "{{ monitorJSON['name'] }}" },
      { variable: 'started_at', source: "{{ heartbeatJSON['localDateTime'] }}" },
      { variable: 'detail_url', source: "{{ monitorJSON['url'] }}" },
      { variable: 'resolved_at', source: "{{ heartbeatJSON['localDateTime'] }}" },
      { variable: 'summary', source: "{{ heartbeatJSON['msg'] }}" },
    ],
    status: { field: CUSTOM_STATUS_FIELD, source: "{{ heartbeatJSON['status'] }}", firing: ['0'], resolved: ['1'] },
    steps: {
      vi: [
        'Settings → Notifications → Setup Notification: Webhook',
        'Post URL: dán URL của EWS; Request Body: Custom Body',
        'Dán body mẫu bên dưới vào ô Custom Body',
        'Additional Headers: {"Content-Type": "application/json"}',
        'Bật thông báo này trong từng monitor',
      ],
      en: [
        'Settings → Notifications → Setup Notification: Webhook',
        'Post URL: paste the EWS URL; Request Body: Custom Body',
        'Paste the sample body below into Custom Body',
        'Additional Headers: {"Content-Type": "application/json"}',
        'Enable this notification on each monitor',
      ],
    },
    fallbacks: { summary: NOT_PROVIDED },
  },
];

export const isIncomingIntegrationId = (value: unknown): value is IncomingIntegrationId =>
  typeof value === 'string' && (INCOMING_INTEGRATION_IDS as readonly string[]).includes(value);

export const isAlertTrigger = (value: unknown): value is AlertTrigger =>
  typeof value === 'string' && (ALERT_TRIGGERS as readonly string[]).includes(value);

export function findIntegration(id: string): IncomingIntegration | null {
  return INCOMING_INTEGRATIONS.find((i) => i.id === id) ?? null;
}

/** Công cụ lạ -> 422 INTEGRATION_UNKNOWN (ADR-0046). */
export function requireIntegration(id: string, path = 'config.integration'): IncomingIntegration {
  const found = findIntegration(id);
  if (!found) throw ValidationError.of('INTEGRATION_UNKNOWN', `unknown integration "${id}"`, path);
  return found;
}

/**
 * `trigger` thật sự áp: công cụ không phân biệt trạng thái -> null; thiếu -> `all`.
 * Lưu đúng giá trị này để console hiện lại đúng lựa chọn.
 */
export function effectiveTrigger(integration: IncomingIntegration, trigger: AlertTrigger | null): AlertTrigger | null {
  return integration.status === null ? null : (trigger ?? 'all');
}

/**
 * Điều kiện phát từ `trigger` (ADR-0046 §3). `all` = trạng thái lỗi HOẶC đã khắc phục — các chuyển trạng thái
 * khác của công cụ (Datadog Warn / No Data, Uptime Kuma bảo trì, lần "Test" không có heartbeat) bị bỏ qua.
 */
export function integrationCondition(integration: IncomingIntegration, trigger: AlertTrigger | null): PublishCondition | null {
  const status = integration.status;
  const effective = effectiveTrigger(integration, trigger);
  if (status === null || effective === null) return null;
  const values =
    effective === 'firing' ? status.firing : effective === 'resolved' ? status.resolved : [...status.firing, ...status.resolved];
  return { path: integration.payload === 'fixed' ? status.source : status.field, values: [...values] };
}

/**
 * Ánh xạ tự dựng = danh mục ∩ biến của bản template đang xuất bản (ADR-0046 §4). `fixed` -> đường dẫn trong JSON
 * của công cụ; `custom` -> trường cùng tên trong body mẫu (`setupBody`) — ghi tường minh để có giá trị dự phòng.
 * Biến template không có trong danh mục vẫn lấy theo trường cùng tên (ADR-0030 §2).
 */
export function integrationMappings(integration: IncomingIntegration, variables: readonly TemplateVariable[]): VariableMapping[] {
  if (integration.payload === 'generic') return [];
  const declared = new Set(variables.map((v) => v.name));
  return integration.fields
    .filter((f) => declared.has(`payload.${f.variable}`))
    .map((f) => ({
      variable: `payload.${f.variable}`,
      kind: 'path' as const,
      path: integration.payload === 'fixed' ? f.source : f.variable,
      defaultValue: integration.fallbacks?.[f.variable] ?? null,
    }));
}

/**
 * Body mẫu để dán vào công cụ `custom` (ADR-0046 §5): mỗi biến `payload.*` của template -> token của công cụ nếu
 * danh mục có, không thì giá trị mẫu của biến; cộng trường trạng thái. Công cụ khác -> null.
 */
export function integrationSetupBody(
  integration: IncomingIntegration,
  variables: readonly { name: string; sample?: string | null | undefined }[],
): Record<string, string> | null {
  if (integration.payload !== 'custom') return null;
  const tokens = new Map(integration.fields.map((f) => [f.variable, f.source]));
  const body: Record<string, string> = {};
  for (const v of variables) {
    if (!v.name.startsWith('payload.')) continue;
    const key = v.name.slice('payload.'.length);
    body[key] = tokens.get(key) ?? v.sample ?? '';
  }
  // Ghi sau cùng: trùng tên với một biến thì trạng thái thắng — điều kiện phát cần nó.
  if (integration.status) body[integration.status.field] = integration.status.source;
  return body;
}

