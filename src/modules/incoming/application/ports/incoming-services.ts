import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AppId, Channel, DomainError, TemplateId, TopicId } from '../../../../shared/kernel/index.ts';

/** Token của hook + băm. Token gốc (`ewshk_…`) chỉ trả về một lần, không lưu. */
export interface HookCrypto {
  issueToken(): { token: string; hash: string; hint: string };
  /** SHA-256 hex — băm token để tra, băm body / khoá để chống trùng. */
  sha256(text: string): string;
}

/** -> apps: app còn gửi được + qua allowlist IP / Origin, cùng luật với `/v1`. Không được -> ném 403. */
export interface AppIngress {
  authorize(input: { appId: AppId; ip: string; origin: string | null }): Promise<{ grantedChannels: readonly Channel[] }>;
}

/** -> templates: biến của bản đang xuất bản. Template không thuộc app -> null. */
export interface TemplateInfo {
  templateId: TemplateId;
  name: string;
  status: 'published' | 'unpublished' | 'archived';
  version: number | null;
  variables: { name: string; required: boolean }[];
}

export interface TemplateCatalog {
  publishedVariables(appId: AppId, templateId: TemplateId): Promise<TemplateInfo | null>;
  /** Xem trước: đổ `payload` vào bản đang xuất bản. Lỗi template là ValidationError (giữ `issues`). */
  render(appId: AppId, templateId: TemplateId, payload: Readonly<Record<string, unknown>>): Promise<{ subject: string; html: string; text: string }>;
}

/** -> topics: topic của app (vài chục mỗi app — lấy cả app một truy vấn). */
export interface TopicCatalog {
  topicsOf(appId: AppId): Promise<{ topicId: TopicId; key: string; status: string; mandatory: boolean }[]>;
}

/** -> notifications: phát vào topic bằng đúng `PublishToTopic` (ADR-0028). */
export interface TopicPublisher {
  publish(
    input: {
      appId: AppId;
      grantedChannels: readonly Channel[];
      topic: string;
      templateId: TemplateId;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    },
    ctx: CommandContext,
  ): Promise<{ publicationId: string; recipientCount: number; created: boolean }>;
}

/** -> settings: con số do Super Admin chỉnh (ADR-0030 §8). */
export interface IncomingSettings {
  current(): Promise<{ dedupeWindowMinutes: number; maxPublicationsPerMinute: number; publicBaseUrl: string | null }>;
}

/** Giới hạn số lần phát mỗi phút của MỘT hook, đếm chung mọi bản api (Redis). */
export interface HookRateLimiter {
  tryAcquire(hookId: string, limitPerMinute: number): Promise<boolean>;
}

/** Lỗi nghiệp vụ -> mã HTTP, để nhật ký gọi ghi đúng mã công cụ ngoài nhận được. */
export type HttpStatusOf = (err: DomainError) => number;
