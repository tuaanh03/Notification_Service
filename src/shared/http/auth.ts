import type { FastifyRequest } from 'fastify';
import { AuthenticationError, type AccountId, type AppId, type Channel, type OrgId } from '../kernel/index.ts';

/**
 * Ai đang gọi — gắn vào request SAU khi xác thực, trước khi route chạy. Route đọc caller qua
 * `appCaller(request)` / `adminCaller(request)`, không tự đọc header credential.
 *
 * Định nghĩa ở shared (không ở module apps) để route của MỌI module (notifications, directory...)
 * dùng được mà không phải import module apps.
 */
export interface AppCaller {
  kind: 'app';
  appId: AppId;
  orgId: OrgId;
  accountId: AccountId;
  slug: string;
  grantedChannels: readonly Channel[];
  rateLimitPerMinute: number;
  maxRecipientsPerEvent: number;
}

export interface AdminCaller {
  kind: 'admin';
  adminId: string;
  role: 'super_admin' | 'app_admin';
}

export type Caller = AppCaller | AdminCaller;

/** Xác thực `/v1/*` — hiện thực bởi module apps (API key + allowlist IP/origin). */
export interface ApiKeyAuthenticator {
  authenticate(input: { apiKey: string | null; ip: string; origin: string | null }): Promise<AppCaller>;
}

/** Xác thực `/admin/*` — tạm thời là bootstrap token; session + RBAC thay thế sau. */
export interface AdminAuthenticator {
  authenticate(input: { bearerToken: string | null }): Promise<AdminCaller>;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

/** `Authorization: Bearer <token>` -> token; không có / sai dạng -> null. */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function appCaller(request: FastifyRequest): AppCaller {
  if (request.caller?.kind !== 'app') throw new AuthenticationError('APP_CALLER_REQUIRED', 'app credentials required');
  return request.caller;
}

export function adminCaller(request: FastifyRequest): AdminCaller {
  if (request.caller?.kind !== 'admin') throw new AuthenticationError('ADMIN_CALLER_REQUIRED', 'admin credentials required');
  return request.caller;
}
