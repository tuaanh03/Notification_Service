import type { FastifyRequest } from 'fastify';
import type { CommandContext } from '../application/command-context.ts';
import {
  AuthenticationError,
  PermissionDeniedError,
  type AccountId,
  type AdminAccess,
  type AdminRole,
  type AppId,
  type Channel,
  type OrgId,
  type PatScope,
  type Permission,
} from '../kernel/index.ts';

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
  role: AdminRole;
  /** Phiên đăng nhập console hay personal access token (ADR-0044). Quyền như nhau — RBAC theo `adminId`. */
  via: 'session' | 'pat';
  /** Chỉ có khi `via = 'pat'`. */
  tokenId: string | null;
  scope: PatScope | null;
}

export type Caller = AppCaller | AdminCaller;

/** Xác thực `/v1/*` — hiện thực bởi module apps (API key + allowlist IP). */
export interface ApiKeyAuthenticator {
  authenticate(input: { apiKey: string | null; ip: string }): Promise<AppCaller>;
}

/** Xác thực `/admin/*` — phiên đăng nhập hoặc personal access token (ADR-0019, ADR-0044). */
export interface AdminAuthenticator {
  /** `ip` chỉ để ghi "dùng lần cuối" của PAT — không dùng để chặn. */
  authenticate(input: { bearerToken: string | null; ip: string | null }): Promise<AdminCaller>;
}

/**
 * Đối tượng route đang chạm — lớp kiểm quyền tự tra app -> org. `none` = việc cấp hệ thống.
 * Giá trị là chuỗi THÔ lấy từ request: id sai định dạng thì lớp kiểm quyền coi như không tồn tại.
 */
export type RouteTarget = { kind: 'app'; appId: string } | { kind: 'org'; orgId: string } | { kind: 'none' };

/**
 * Quyền mà MỘT route `/admin` cần (ADR-0022). Route nào thiếu khai báo này thì server không khởi
 * động (`buildHttpServer`) — không có route nào lọt lưới vì quên.
 *
 * `target` mặc định: `:appId` trên URL -> app, không có thì `:orgId` -> org, không có nữa -> `none`.
 * `permission` là hàm khi quyền phụ thuộc request (vd. `/apps/:appId/:action`).
 */
export interface RouteAccess {
  permission: Permission | ((request: FastifyRequest) => Permission);
  target?: ((request: FastifyRequest) => RouteTarget) | undefined;
}

/** `{ config: access('app.read') }` — gắn quyền vào options của route. */
export function access(
  permission: RouteAccess['permission'],
  target?: RouteAccess['target'],
): { access: RouteAccess } {
  return { access: { permission, target } };
}

/** Kiểm quyền `/admin/*` — hiện thực bởi module apps. Không được phép -> ném 404 / 403. */
export interface AdminAuthorizer {
  authorize(input: { caller: AdminCaller; permission: Permission; target: RouteTarget }): Promise<AdminAccess>;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
    /** Vai của admin đang gọi — có sau bước kiểm quyền; route danh sách dùng để lọc. */
    adminAccess: AdminAccess | null;
  }
  interface FastifyContextConfig {
    access?: RouteAccess | undefined;
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

/** Vai của admin đang gọi, đã tra ở bước kiểm quyền — route danh sách lọc theo nó. */
export function adminAccess(request: FastifyRequest): AdminAccess {
  if (request.adminAccess === null) throw new AuthenticationError('ADMIN_CALLER_REQUIRED', 'admin credentials required');
  return request.adminAccess;
}

/**
 * Route chỉ nhận PHIÊN đăng nhập, không nhận PAT (ADR-0044 §6) — quản lý chính PAT. Gọi ĐẦU handler: lộ một PAT
 * không được phép đẻ ra PAT mới sống lâu hơn nó.
 */
export function requireSession(request: FastifyRequest): AdminCaller {
  const caller = adminCaller(request);
  if (caller.via !== 'session') throw new PermissionDeniedError('SESSION_REQUIRED', 'this route requires a console session, not a personal access token');
  return caller;
}

/** `CommandContext` của lệnh ghi qua `/admin`: người làm là admin, nguồn audit tách phiên (`admin_api`) với PAT (`admin_pat`). */
export function adminContext(request: FastifyRequest): CommandContext {
  const caller = adminCaller(request);
  return { actor: { id: caller.adminId, type: 'admin' }, source: caller.via === 'pat' ? 'admin_pat' : 'admin_api' };
}
