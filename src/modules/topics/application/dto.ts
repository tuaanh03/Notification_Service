import type { Topic } from '../domain/entities/topic.ts';
import type { UserEmailSummary } from './ports/index.ts';

/** Topic nhìn từ console quản trị — đủ trạng thái. */
export interface TopicDto {
  id: string;
  key: string;
  name: string;
  status: string;
  mandatory: boolean;
  defaultMode: string;
  createdAt: string;
  updatedAt: string;
}

/** Topic nhìn từ app service (`GET /v1/topics`) — chỉ topic `active`, không có id nội bộ. */
export interface PublicTopicDto {
  key: string;
  name: string;
  mandatory: boolean;
  defaultMode: string;
}

export interface TopicPreferenceDto extends PublicTopicDto {
  /** Lựa chọn user đã ghi; null = chưa chọn, đang theo `defaultMode`. */
  optedIn: boolean | null;
  /**
   * Kết quả lớp L3 (`effectiveOptIn`): topic này có qua được lớp preference không. KHÔNG tính L0
   * (email chết) và L1 (`optedOutOptional`) — hai lớp đó nằm ở `email`, xét riêng lúc gửi.
   */
  effectiveOptIn: boolean;
}

export interface UserPreferencesDto {
  externalId: string;
  /** null = user chưa có email. */
  email: UserEmailSummary | null;
  topics: TopicPreferenceDto[];
}

export const toTopicDto = (t: Topic): TopicDto => ({
  id: t.id,
  key: t.key,
  name: t.name,
  status: t.status,
  mandatory: t.mandatory,
  defaultMode: t.defaultMode,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export const toPublicTopicDto = (t: Topic): PublicTopicDto => ({
  key: t.key,
  name: t.name,
  mandatory: t.mandatory,
  defaultMode: t.defaultMode,
});
