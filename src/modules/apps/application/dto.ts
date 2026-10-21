import type { App } from '../domain/entities/app.ts';
import type { AppNetworkRule } from '../domain/entities/app-network-rule.ts';
import type { AppSecret } from '../domain/entities/app-secret.ts';

export interface AppDto {
  id: string;
  orgId: string;
  accountId: string;
  slug: string;
  name: string;
  namespace: string;
  status: string;
  origin: string;
  grantedChannels: readonly string[];
  rateLimitPerMinute: number;
  maxRecipientsPerEvent: number;
  includedInOrgBroadcast: boolean;
  isSystem: boolean;
  /** Đếm "đã mở" bằng ảnh theo dõi (ADR-0031). */
  trackOpens: boolean;
  /** Khung giờ gửi, giờ Việt Nam (ADR-0032). null = gửi mọi lúc. */
  sendWindow: { days: number[]; start: string; end: string } | null;
  /** Tin bắt buộc bỏ qua khung giờ. */
  mandatoryBypassWindow: boolean;
  /** Dàn đều: tối đa N thư / phút (ADR-0032 GĐ 2). null = không dàn. */
  sendPerMinute: number | null;
  /** Tin bắt buộc không bị dàn đều. */
  mandatoryBypassPacing: boolean;
  /** Trần tốc độ do Super Admin đặt. null = không trần riêng. */
  maxSendPerMinute: number | null;
  /** Trần thư mỗi giờ do Super Admin đặt (ADR-0032 GĐ 3). null = không trần. */
  maxSendPerHour: number | null;
  /** Tin bắt buộc được vượt trần mỗi giờ. */
  mandatoryBypassHourly: boolean;
  /** Mỗi người nhận tối đa N thư / ngày (ADR-0032 GĐ 3). null = không giới hạn. */
  recipientDailyLimit: number | null;
  /** Tin bắt buộc không tính vào giới hạn mỗi người. */
  mandatoryBypassRecipientLimit: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Không bao giờ có hash hay plaintext ở đây — chỉ hint để người dùng nhận ra key nào. */
export interface AppSecretDto {
  id: string;
  hint: string;
  name: string | null;
  status: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** Trả về DUY NHẤT một lần, ngay lúc tạo (UC-001 BR-4). */
export interface IssuedAppSecretDto extends AppSecretDto {
  apiKey: string;
}

export interface NetworkRuleDto {
  kind: string;
  value: string;
}

/** Caller `/v1/*` đã xác thực — composition đổi sang `AppCaller` của shared/http. */
export interface AuthenticatedApp {
  appId: App['id'];
  orgId: App['orgId'];
  accountId: App['accountId'];
  slug: string;
  grantedChannels: App['grantedChannels'];
  rateLimitPerMinute: number;
  maxRecipientsPerEvent: number;
}

export const toAppDto = (a: App): AppDto => ({
  id: a.id,
  orgId: a.orgId,
  accountId: a.accountId,
  slug: a.slug,
  name: a.name,
  namespace: a.namespace,
  status: a.status,
  origin: a.origin,
  grantedChannels: a.grantedChannels,
  rateLimitPerMinute: a.rateLimitPerMinute,
  maxRecipientsPerEvent: a.maxRecipientsPerEvent,
  includedInOrgBroadcast: a.includedInOrgBroadcast,
  isSystem: a.isSystem,
  trackOpens: a.trackOpens,
  sendWindow: a.sendWindow === null ? null : { ...a.sendWindow, days: [...a.sendWindow.days] },
  mandatoryBypassWindow: a.mandatoryBypassWindow,
  sendPerMinute: a.sendPerMinute,
  mandatoryBypassPacing: a.mandatoryBypassPacing,
  maxSendPerMinute: a.maxSendPerMinute,
  maxSendPerHour: a.maxSendPerHour,
  mandatoryBypassHourly: a.mandatoryBypassHourly,
  recipientDailyLimit: a.recipientDailyLimit,
  mandatoryBypassRecipientLimit: a.mandatoryBypassRecipientLimit,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

export const toAppSecretDto = (s: AppSecret): AppSecretDto => ({
  id: s.id,
  hint: s.hint,
  name: s.name,
  status: s.status,
  createdAt: s.createdAt.toISOString(),
  revokedAt: s.revokedAt?.toISOString() ?? null,
  lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
});

export const toNetworkRuleDto = (r: AppNetworkRule): NetworkRuleDto => ({ kind: r.kind, value: r.value });
