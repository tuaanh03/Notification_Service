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
  createdAt: string;
  updatedAt: string;
}

/** Không bao giờ có hash hay plaintext ở đây — chỉ hint để người dùng nhận ra key nào. */
export interface AppSecretDto {
  id: string;
  hint: string;
  status: string;
  createdAt: string;
  revokedAt: string | null;
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
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

export const toAppSecretDto = (s: AppSecret): AppSecretDto => ({
  id: s.id,
  hint: s.hint,
  status: s.status,
  createdAt: s.createdAt.toISOString(),
  revokedAt: s.revokedAt?.toISOString() ?? null,
});

export const toNetworkRuleDto = (r: AppNetworkRule): NetworkRuleDto => ({ kind: r.kind, value: r.value });
