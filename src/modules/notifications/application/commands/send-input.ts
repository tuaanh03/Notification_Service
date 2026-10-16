import { ValidationError, type AppId, type Channel, type NotificationOrigin, type TemplateId } from '../../../../shared/kernel/index.ts';
import { emailContent, type EmailContent } from '../../domain/types/email-content.ts';
import type { TopicConsentLookup, TopicForDelivery } from '../ports/index.ts';

/** Phần nội dung chung của gửi lẻ (`POST /v1/notifications`) và phát vào topic (`POST /v1/publications`). */
export interface SendContentInput {
  grantedChannels: readonly Channel[];
  /** `api` (mặc định) = app gọi `/v1`; `dashboard` = người quản lý app gửi từ màn Soạn thông báo. */
  origin?: NotificationOrigin | undefined;
  /** Cách 1 — nội dung viết thẳng. */
  subject?: string | undefined;
  html?: string | undefined;
  text?: string | undefined;
  /** Cách 2 — template đã xuất bản (ADR-0020). Loại trừ với cách 1. */
  templateId?: TemplateId | undefined;
  payload?: Record<string, unknown> | undefined;
}

export type SendSource = { kind: 'direct'; content: EmailContent } | { kind: 'template'; templateId: TemplateId };

/**
 * Kiểm input trước mọi truy vấn: CHANNEL_NOT_GRANTED · CONTENT_AND_TEMPLATE_CONFLICT · PAYLOAD_REQUIRES_TEMPLATE
 * · nội dung viết thẳng sai (EmailContent). Nội dung từ template kiểm sau khi đổ biến (cùng `emailContent()`).
 */
export function parseSendSource(input: SendContentInput): SendSource {
  if (!input.grantedChannels.includes('email')) {
    throw ValidationError.of('CHANNEL_NOT_GRANTED', 'this app is not granted the email channel', 'channel');
  }
  const templateId = input.templateId;
  if (templateId && [input.subject, input.html, input.text].some((field) => field !== undefined)) {
    throw ValidationError.of(
      'CONTENT_AND_TEMPLATE_CONFLICT',
      'send either templateId + payload or subject + html, not both',
      'templateId',
    );
  }
  if (!templateId && input.payload !== undefined) {
    throw ValidationError.of('PAYLOAD_REQUIRES_TEMPLATE', 'payload is only used together with templateId', 'payload');
  }
  return templateId
    ? { kind: 'template', templateId }
    : {
        kind: 'direct',
        content: emailContent({ subject: input.subject ?? '', html: input.html ?? '', text: input.text }),
      };
}

/** TOPIC_NOT_FOUND · TOPIC_NOT_ACTIVE. */
export async function requireActiveTopic(topics: TopicConsentLookup, appId: AppId, key: string): Promise<TopicForDelivery> {
  const topic = await topics.topicByKey(appId, key);
  if (!topic) throw ValidationError.of('TOPIC_NOT_FOUND', `topic ${key} does not exist`, 'topic');
  if (topic.status !== 'active') {
    throw ValidationError.of('TOPIC_NOT_ACTIVE', `topic ${key} is ${topic.status}`, 'topic');
  }
  return topic;
}
