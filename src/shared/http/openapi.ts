import { z, type ZodType } from 'zod';
import type { RouteAccess } from './auth.ts';

/**
 * Mô tả MỘT route cho OpenAPI (ADR-0045) — khai ngay tại route, cạnh `access(...)`:
 *   app.post('/apps/:appId/topics', { config: { ...access('app.manage'), ...doc({ tag: 'topics', summary: '…', body }) } }, …)
 * `params` / `query` / `body` / `response` là CHÍNH schema zod route dùng để parse — đổi schema là spec đổi theo.
 * Chữ (summary, description) viết tiếng Anh: một ngôn ngữ cho dev, như error message.
 */
export interface RouteDoc {
  /** Nhóm hiển thị — tên ổn định, chữ thường (`apps`, `templates`…). Danh sách + mô tả ở `OPENAPI_TAGS`. */
  tag: string;
  summary: string;
  description?: string | undefined;
  params?: ZodType | undefined;
  query?: ZodType | undefined;
  body?: ZodType | undefined;
  /** JSON mẫu cho body — không có thì console tự sinh từ schema. */
  example?: unknown;
  response?: ZodType | undefined;
  /** Tên DTO (trong `dto.ts`) khi chưa có schema zod cho response. */
  responseDto?: string | undefined;
  /** Mã thành công: mặc định 200. */
  status?: 200 | 201 | 202 | 204 | undefined;
  /** Lỗi nghiệp vụ riêng của route. Lỗi chung (401, 403 quyền, 404 ẩn, 422 VALIDATION) tự thêm. */
  errors?: ReadonlyArray<{ status: number; code: string }> | undefined;
  /** Route chỉ nhận phiên đăng nhập console — PAT nhận 403 `SESSION_REQUIRED` (ADR-0044 §6). */
  sessionOnly?: boolean | undefined;
}

/** `{ config: { ...access('app.read'), ...doc({...}) } }` — hoặc `{ config: doc({...}) }` ở `/v1`, `/hooks`. */
export function doc(d: RouteDoc): { doc: RouteDoc } {
  return { doc: d };
}

declare module 'fastify' {
  interface FastifyContextConfig {
    doc?: RouteDoc | undefined;
  }
}

export type ApiSurface = 'admin' | 'v1' | 'hooks';

/** Một route đã đăng ký, gom lúc dựng server. */
export interface RegisteredRoute {
  surface: ApiSurface;
  method: string;
  /** Đường dẫn Fastify đầy đủ: `/admin/apps/:appId`. */
  url: string;
  access: RouteAccess | undefined;
  doc: RouteDoc | undefined;
}

/** Thứ tự + mô tả nhóm trên trang Developer. Tag dùng ở route mà không có ở đây vẫn hiện, xếp cuối. */
export const OPENAPI_TAGS: ReadonlyArray<{ name: string; description: string; surface: ApiSurface }> = [
  { name: 'me', description: 'Who is calling: profile, roles and how the request was authenticated.', surface: 'admin' },
  { name: 'personal-access-tokens', description: 'Personal access tokens. Managed only from a console session.', surface: 'admin' },
  { name: 'organizations', description: 'Organizations, members and app roles.', surface: 'admin' },
  { name: 'apps', description: 'Apps: register, lifecycle, API keys, network rules, sending limits.', surface: 'admin' },
  { name: 'topics', description: 'Topics: the consent question "does this person want this kind of message".', surface: 'admin' },
  { name: 'templates', description: 'Email templates: draft, publish, presets, AI compose, stats.', surface: 'admin' },
  { name: 'users', description: 'Recipients of one app and their preferences (read-mostly).', surface: 'admin' },
  { name: 'notifications', description: 'Send history, overview, sending from the console.', surface: 'admin' },
  { name: 'webhooks', description: 'Outgoing webhooks: EWS calls your URL when an email is sent, failed or opened.', surface: 'admin' },
  { name: 'incoming-webhooks', description: 'Incoming webhooks: a secret URL that turns monitoring alerts into emails.', surface: 'admin' },
  { name: 'audit', description: 'Audit log.', surface: 'admin' },
  { name: 'directory', description: 'Microsoft 365 directory sync (Super Admin).', surface: 'admin' },
  { name: 'security', description: 'Login lockouts (Super Admin).', surface: 'admin' },
  { name: 'system-settings', description: 'System settings (Super Admin).', surface: 'admin' },
  { name: 'queues', description: 'Delivery queues (Redis Streams): groups, dead letters, pause. Super Admin only.', surface: 'admin' },
  { name: 'v1', description: 'App API — called by an app service with its API key.', surface: 'v1' },
  { name: 'hooks', description: 'Incoming webhook endpoint — the token in the URL is the credential.', surface: 'hooks' },
];

/** Quyền ai đăng nhập cũng có — không sinh lỗi 403 / 404 theo RBAC. */
const OPEN_PERMISSIONS = new Set(['self.read', 'org.create', 'catalog.read']);
const READ_METHODS = new Set(['GET', 'HEAD']);

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad request',
  401: 'Missing or invalid credentials',
  403: 'Forbidden',
  404: 'Not found (or not visible to you)',
  409: 'Conflict',
  413: 'Body too large',
  422: 'Validation failed — see issues[].code',
  429: 'Rate limited — see Retry-After',
  502: 'Upstream failure',
  503: 'Not configured or unavailable',
};

/** zod -> JSON Schema 2020-12 cho request (dạng NHẬN vào), bỏ phần nhiễu không giúp người đọc. */
export function jsonSchemaOf(schema: ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete raw['$schema'];
  return clean(raw) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    // Giới hạn số nguyên an toàn của JS — đúng nhưng chỉ làm rối bảng.
    if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
    out[k] = clean(v);
  }
  // Regex uuid dài một dòng — `format: uuid` đã nói đủ.
  if (out['format'] === 'uuid') delete out['pattern'];
  return out;
}

/** `/admin/apps/:appId` -> `/admin/apps/{appId}` + danh sách tên tham số. */
function openApiPath(url: string): { path: string; names: string[] } {
  const names: string[] = [];
  const path = url.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    names.push(name);
    return `{${name}}`;
  });
  return { path, names };
}

function permissionOf(rule: RouteAccess | undefined): string | null {
  if (rule === undefined) return null;
  return typeof rule.permission === 'string' ? rule.permission : 'depends-on-request';
}

function problemResponse(status: number, codes: string[]): Record<string, unknown> {
  const description = codes.length > 0 ? `${STATUS_TEXT[status] ?? 'Error'}: ${codes.join(', ')}` : (STATUS_TEXT[status] ?? 'Error');
  return { description, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } };
}

function operationOf(route: RegisteredRoute): Record<string, unknown> {
  const d = route.doc!;
  const { names } = openApiPath(route.url);
  const op: Record<string, unknown> = {
    operationId: `${route.method.toLowerCase()}${route.url.replace(/[/:{}-]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
    tags: [d.tag],
    summary: d.summary,
  };
  if (d.description) op['description'] = d.description;

  // Tham số path luôn bắt buộc; schema lấy từ `params` nếu route khai.
  const paramSchema = d.params ? jsonSchemaOf(d.params) : null;
  const paramProps = (paramSchema?.['properties'] ?? {}) as Record<string, unknown>;
  const parameters: Record<string, unknown>[] = names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: paramProps[name] ?? { type: 'string' },
  }));
  if (d.query) {
    const q = jsonSchemaOf(d.query);
    const props = (q['properties'] ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((q['required'] ?? []) as string[]);
    for (const [name, schema] of Object.entries(props)) {
      parameters.push({ name, in: 'query', required: required.has(name), schema, ...(schema['description'] ? { description: schema['description'] } : {}) });
    }
  }
  if (parameters.length > 0) op['parameters'] = parameters;

  if (d.body) {
    const media: Record<string, unknown> = { schema: jsonSchemaOf(d.body) };
    if (d.example !== undefined) media['example'] = d.example;
    op['requestBody'] = { required: true, content: { 'application/json': media } };
  }

  const status = d.status ?? 200;
  const success: Record<string, unknown> = { description: STATUS_TEXT[status] ?? 'OK' };
  if (status !== 204) {
    if (d.response) success['content'] = { 'application/json': { schema: jsonSchemaOf(d.response) } };
    else if (d.responseDto) {
      success['content'] = { 'application/json': { schema: { type: 'object' } } };
      success['x-ews-dto'] = d.responseDto;
    }
  }

  // Lỗi: chung theo bề mặt + quyền, rồi lỗi riêng của route.
  const errors: Array<{ status: number; code: string }> = [];
  const permission = permissionOf(route.access);
  if (route.surface === 'admin') {
    errors.push({ status: 401, code: 'INVALID_ADMIN_SESSION' });
    if (!READ_METHODS.has(route.method)) errors.push({ status: 403, code: 'PAT_SCOPE_INSUFFICIENT' });
    if (d.sessionOnly) errors.push({ status: 403, code: 'SESSION_REQUIRED' });
    if (permission !== null && !OPEN_PERMISSIONS.has(permission)) {
      errors.push({ status: 403, code: 'FORBIDDEN' });
      if (names.length > 0) errors.push({ status: 404, code: 'NOT_FOUND' });
    }
  } else if (route.surface === 'v1') {
    errors.push({ status: 401, code: 'API_KEY_REQUIRED' }, { status: 401, code: 'INVALID_API_KEY' }, { status: 403, code: 'APP_NOT_ACTIVE' }, { status: 403, code: 'IP_NOT_ALLOWED' });
  }
  if (d.body || d.query || d.params) errors.push({ status: 422, code: 'VALIDATION' });
  for (const e of d.errors ?? []) if (!errors.some((x) => x.status === e.status && x.code === e.code)) errors.push(e);

  const responses: Record<string, unknown> = { [String(status)]: success };
  for (const s of [...new Set(errors.map((e) => e.status))].sort((a, b) => a - b)) {
    responses[String(s)] = problemResponse(
      s,
      errors.filter((e) => e.status === s).map((e) => e.code),
    );
  }
  op['responses'] = responses;
  op['x-ews-errors'] = errors;

  if (route.surface === 'admin') {
    op['security'] = [{ pat: [] }];
    op['x-ews-permission'] = permission;
    op['x-ews-pat-scope'] = READ_METHODS.has(route.method) ? 'read' : 'write';
    if (d.sessionOnly) op['x-ews-session-only'] = true;
  } else if (route.surface === 'v1') op['security'] = [{ appKey: [] }];
  else op['security'] = [];
  return op;
}

/** Dựng tài liệu OpenAPI 3.1 từ các route đã đăng ký. Route không có `doc` bị bỏ qua (test ép mọi route phải có). */
export function buildOpenApiDocument(routes: readonly RegisteredRoute[], options: { serverUrl: string | null; version: string }): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const used = new Set<string>();
  const sorted = [...routes].filter((r) => r.doc !== undefined && r.method !== 'HEAD').sort((a, b) => a.url.localeCompare(b.url));
  for (const route of sorted) {
    const { path } = openApiPath(route.url);
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = operationOf(route);
    used.add(route.doc!.tag);
  }
  const known = OPENAPI_TAGS.filter((t) => used.has(t.name)).map((t) => ({ name: t.name, description: t.description, 'x-ews-surface': t.surface }));
  const extra = [...used].filter((name) => !OPENAPI_TAGS.some((t) => t.name === name)).map((name) => ({ name }));

  return {
    openapi: '3.1.0',
    info: {
      title: 'EWS AstroLink API',
      version: options.version,
      description:
        'Admin API (`/admin`, personal access token), App API (`/v1`, app API key) and incoming webhooks (`/hooks`). Errors are RFC 9457 problem+json; match on `code`, never on `detail`.',
    },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    tags: [...known, ...extra],
    paths,
    components: {
      securitySchemes: {
        pat: { type: 'http', scheme: 'bearer', bearerFormat: 'ewspat_…', description: 'Personal access token (ADR-0044). Acts with your own roles.' },
        appKey: { type: 'http', scheme: 'bearer', bearerFormat: 'ews_<32 hex>_<43 chars>', description: 'API key of one app.' },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'code', 'detail'],
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            code: { type: 'string', description: 'Stable error code — match on this.' },
            detail: { type: 'string', description: 'Human-readable, English. Do not parse.' },
            instance: { type: 'string' },
            issues: {
              type: 'array',
              description: 'Only for 422: one entry per violation.',
              items: {
                type: 'object',
                required: ['code', 'message'],
                properties: { code: { type: 'string' }, message: { type: 'string' }, path: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}
