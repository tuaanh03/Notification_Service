import type { IncomingCall } from '../domain/entities/incoming-call.ts';
import type { IncomingHook } from '../domain/entities/incoming-hook.ts';
import type { AlertTrigger, IncomingIntegration, IncomingIntegrationId, IntegrationPayload } from '../domain/rules/integrations.ts';
import type { ExtractedVariable } from '../domain/rules/payload-extraction.ts';
import type { PublishCondition, VariableMapping } from '../domain/types/hook-config.ts';
import type { Issue } from '../../../shared/kernel/index.ts';

/** Điều cần sửa ở hook — console hiện cạnh hook (mọi lần gọi sẽ lỗi nếu bỏ qua). */
export interface HookWarningDto {
  /** TEMPLATE_NOT_PUBLISHED · TEMPLATE_ARCHIVED · TEMPLATE_NOT_FOUND · TOPIC_NOT_ACTIVE · TOPIC_NOT_FOUND
   *  · REQUIRED_VARIABLE_UNMAPPED (chỉ có giá trị nếu JSON có trường cùng tên ở tầng đầu)
   *  · MAPPING_NOT_IN_TEMPLATE (bản template hiện tại không khai biến này — bị bỏ qua) */
  code: string;
  variable?: string | undefined;
}

/** KHÔNG có token — token chỉ nằm trong response tạo / đổi URL. */
export interface IncomingHookDto {
  id: string;
  name: string;
  topic: { id: string; key: string | null };
  template: { id: string; name: string | null; status: string | null; version: number | null };
  mappings: VariableMapping[];
  dedupePath: string | null;
  condition: PublishCondition | null;
  /** Công cụ giám sát đã chọn (ADR-0046); null = cấu hình tay / hook cũ. */
  integration: IncomingIntegrationId | null;
  trigger: AlertTrigger | null;
  /** Body để dán vào công cụ `custom` (Datadog, Gatus, Uptime Kuma) — dựng theo bản template đang xuất bản; công cụ khác -> null. */
  setupBody: Record<string, string> | null;
  /** active | disabled */
  status: string;
  tokenHint: string;
  warnings: HookWarningDto[];
  createdAt: string;
  updatedAt: string;
}

export interface IncomingHookListDto {
  /** false = server thiếu `WEBHOOK_SIGNING_KEY`: không tạo / lấy URL được. */
  configured: boolean;
  /** Domain API công khai trong Cài đặt hệ thống; null = chưa khai (console chỉ hiện đường dẫn). */
  publicBaseUrl: string | null;
  hooks: IncomingHookDto[];
}

/** Response DUY NHẤT có token — tạo hook / đổi URL. */
export interface IssuedHookUrlDto {
  hook: IncomingHookDto;
  token: string;
  /** `/hooks/<token>` — luôn có. */
  path: string;
  /** URL đầy đủ nếu đã khai domain API công khai; null nếu chưa. */
  url: string | null;
}

export interface IncomingCallDto {
  id: string;
  at: string;
  httpStatus: number;
  /** published | duplicate | skipped | rejected */
  outcome: string;
  publicationId: string | null;
  recipientCount: number | null;
  errorCode: string | null;
  /** Trường gắn với lỗi (`["service"]`) — console hiện "Thiếu trường bắt buộc: service". */
  errorFields: string[] | null;
}

/** Kết quả trả cho công cụ ngoài gọi `POST /hooks/:token`. */
export type IncomingCallResult =
  | { status: 'published' | 'duplicate'; publicationId: string; recipientCount: number }
  | { status: 'skipped'; reason: 'condition_not_met' };

/** "Xem trước" trên console — không ghi gì, không gửi gì. */
export interface HookPreviewDto {
  conditionMet: boolean;
  /** Khoá chống trùng sẽ lấy từ đâu: header · path (giá trị ở đường dẫn đã khai) · body_hash (băm body + khung thời gian). */
  dedupe: { source: 'header' | 'path' | 'body_hash'; value: string | null; windowMinutes: number };
  variables: ExtractedVariable[];
  unusedMappings: string[];
  /** Giá trị không dùng được (INVALID_PAYLOAD_VALUE). */
  issues: Issue[];
  template: { name: string | null; status: string | null; version: number | null };
  /** Thư sau khi đổ biến (`user.external_id` = "preview"); null khi chưa đổ được — lý do ở `renderIssues`. */
  rendered: { subject: string; html: string; text: string } | null;
  renderIssues: Issue[];
}

const iso = (d: Date) => d.toISOString();

export function toIncomingHookDto(
  hook: IncomingHook,
  extra: {
    topic: { key: string } | null;
    template: { name: string; status: string; version: number | null } | null;
    warnings: HookWarningDto[];
    setupBody: Record<string, string> | null;
  },
): IncomingHookDto {
  return {
    id: hook.id,
    name: hook.name,
    topic: { id: hook.topicId, key: extra.topic?.key ?? null },
    template: {
      id: hook.templateId,
      name: extra.template?.name ?? null,
      status: extra.template?.status ?? null,
      version: extra.template?.version ?? null,
    },
    mappings: [...hook.mappings],
    dedupePath: hook.dedupePath,
    condition: hook.condition,
    integration: hook.integration,
    trigger: hook.trigger,
    setupBody: extra.setupBody,
    status: hook.status,
    tokenHint: hook.tokenHint,
    warnings: extra.warnings,
    createdAt: iso(hook.createdAt),
    updatedAt: iso(hook.updatedAt),
  };
}

/** Một công cụ trong danh mục (ADR-0046) — `GET /admin/incoming-integrations`. */
export interface IncomingIntegrationDto {
  id: IncomingIntegrationId;
  name: string;
  payload: IntegrationPayload;
  /** Trang hướng dẫn webhook của công cụ. */
  docsUrl: string | null;
  /** Biến (không có tiền tố `payload.`) -> token (custom) hoặc đường dẫn JSON (fixed). */
  fields: Array<{ variable: string; source: string }>;
  /** custom = tên trường thêm vào body + token · fixed = đường dẫn. null = không phân biệt. */
  status: { field: string; source: string; firing: string[]; resolved: string[] } | null;
  /** Các bước cài trên công cụ — chữ ngắn, đã dịch. */
  steps: { vi: string[]; en: string[] };
}

/** Không lộ `fallbacks` — đó là chi tiết của ánh xạ tự dựng, đã nằm trong `mappings` của hook. */
export const toIncomingIntegrationDto = (i: IncomingIntegration): IncomingIntegrationDto => ({
  id: i.id,
  name: i.name,
  payload: i.payload,
  docsUrl: i.docsUrl,
  fields: i.fields.map((f) => ({ variable: f.variable, source: f.source })),
  status: i.status === null ? null : { ...i.status, firing: [...i.status.firing], resolved: [...i.status.resolved] },
  steps: { vi: [...i.steps.vi], en: [...i.steps.en] },
});

export const toIncomingCallDto = (c: IncomingCall): IncomingCallDto => ({
  id: c.id,
  at: iso(c.at),
  httpStatus: c.httpStatus,
  outcome: c.outcome,
  publicationId: c.publicationId,
  recipientCount: c.recipientCount,
  errorCode: c.errorCode,
  errorFields: c.errorFields,
});
