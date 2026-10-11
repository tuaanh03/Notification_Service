import type { IncomingCall } from '../domain/entities/incoming-call.ts';
import type { IncomingHook } from '../domain/entities/incoming-hook.ts';
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
  /** active | disabled */
  status: string;
  tokenHint: string;
  warnings: HookWarningDto[];
  createdAt: string;
  updatedAt: string;
}

export interface IncomingHookListDto {
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
    status: hook.status,
    tokenHint: hook.tokenHint,
    warnings: extra.warnings,
    createdAt: iso(hook.createdAt),
    updatedAt: iso(hook.updatedAt),
  };
}

export const toIncomingCallDto = (c: IncomingCall): IncomingCallDto => ({
  id: c.id,
  at: iso(c.at),
  httpStatus: c.httpStatus,
  outcome: c.outcome,
  publicationId: c.publicationId,
  recipientCount: c.recipientCount,
  errorCode: c.errorCode,
});
