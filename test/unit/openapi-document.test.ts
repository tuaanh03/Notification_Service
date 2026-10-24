import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument, type RegisteredRoute } from '../../src/shared/http/index.ts';

/** ADR-0045: tài liệu OpenAPI dựng từ route thật + `doc()` — kiểm hình dạng, lỗi tự thêm, security theo bề mặt. */
const routes: RegisteredRoute[] = [
  {
    surface: 'admin',
    method: 'GET',
    url: '/admin/apps/:appId/topics',
    access: { permission: 'app.read' },
    doc: { tag: 'topics', summary: 'List topics', params: z.object({ appId: z.uuid() }) },
  },
  {
    surface: 'admin',
    method: 'POST',
    url: '/admin/apps/:appId/topics',
    access: { permission: 'app.manage' },
    doc: {
      tag: 'topics',
      summary: 'Create a topic',
      params: z.object({ appId: z.uuid() }),
      body: z.object({ topicKey: z.string(), name: z.string() }).strict(),
      example: { topicKey: 'incident', name: 'Incident' },
      status: 201,
      responseDto: 'TopicDto',
      errors: [{ status: 409, code: 'TOPIC_KEY_TAKEN' }],
    },
  },
  {
    surface: 'admin',
    method: 'POST',
    url: '/admin/me/tokens',
    access: { permission: 'self.read' },
    doc: { tag: 'personal-access-tokens', summary: 'Create a PAT', body: z.object({ name: z.string() }), sessionOnly: true, status: 201 },
  },
  {
    surface: 'v1',
    method: 'POST',
    url: '/v1/notifications',
    access: undefined,
    doc: { tag: 'v1', summary: 'Send a notification', body: z.object({ topicKey: z.string() }), status: 202 },
  },
  { surface: 'hooks', method: 'POST', url: '/hooks/:token', access: undefined, doc: { tag: 'hooks', summary: 'Incoming webhook' } },
  // Không có doc -> không vào tài liệu; HEAD bị bỏ.
  { surface: 'admin', method: 'GET', url: '/admin/hidden', access: { permission: 'app.read' }, doc: undefined },
  { surface: 'admin', method: 'HEAD', url: '/admin/apps/:appId/topics', access: { permission: 'app.read' }, doc: { tag: 'topics', summary: 'x' } },
];

const document = buildOpenApiDocument(routes, { serverUrl: 'https://api.example.test', version: '1.2.3' });
const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
const op = (path: string, method: string): Record<string, unknown> => paths[path]![method]!;

describe('buildOpenApiDocument', () => {
  it('đổi `:param` thành `{param}`, bỏ route không doc và HEAD', () => {
    expect(document['openapi']).toBe('3.1.0');
    expect(Object.keys(paths).sort()).toEqual(['/admin/apps/{appId}/topics', '/admin/me/tokens', '/hooks/{token}', '/v1/notifications']);
    expect(Object.keys(paths['/admin/apps/{appId}/topics']!).sort()).toEqual(['get', 'post']);
    expect(document['servers']).toEqual([{ url: 'https://api.example.test' }]);
    expect((document['info'] as { version: string }).version).toBe('1.2.3');
  });

  it('không có serverUrl thì không có servers', () => {
    expect(buildOpenApiDocument(routes, { serverUrl: null, version: '1' })['servers']).toBeUndefined();
  });

  it('tag theo thứ tự OPENAPI_TAGS, chỉ tag có dùng, kèm bề mặt', () => {
    const tags = document['tags'] as Array<{ name: string; 'x-ews-surface'?: string }>;
    expect(tags.map((t) => t.name)).toEqual(['personal-access-tokens', 'topics', 'v1', 'hooks']);
    expect(tags.find((t) => t.name === 'v1')!['x-ews-surface']).toBe('v1');
  });

  it('route đọc /admin: path param bắt buộc, lỗi chung, scope read', () => {
    const get = op('/admin/apps/{appId}/topics', 'get');
    expect(get['parameters']).toEqual([expect.objectContaining({ name: 'appId', in: 'path', required: true })]);
    expect(get['security']).toEqual([{ pat: [] }]);
    expect(get['x-ews-permission']).toBe('app.read');
    expect(get['x-ews-pat-scope']).toBe('read');
    expect(get['x-ews-errors']).toEqual([
      { status: 401, code: 'INVALID_ADMIN_SESSION' },
      { status: 403, code: 'FORBIDDEN' },
      { status: 404, code: 'NOT_FOUND' },
      { status: 422, code: 'VALIDATION' },
    ]);
  });

  it('route ghi /admin: body + ví dụ, mã thành công, DTO, lỗi riêng và PAT_SCOPE_INSUFFICIENT', () => {
    const post = op('/admin/apps/{appId}/topics', 'post');
    const body = (post['requestBody'] as { content: Record<string, { schema: Record<string, unknown>; example: unknown }> }).content['application/json']!;
    expect(body.example).toEqual({ topicKey: 'incident', name: 'Incident' });
    expect(body.schema['$schema']).toBeUndefined();
    expect(body.schema['required']).toEqual(['topicKey', 'name']);
    const responses = post['responses'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(responses)).toEqual(['201', '401', '403', '404', '409', '422']);
    expect(responses['201']!['x-ews-dto']).toBe('TopicDto');
    expect(post['x-ews-pat-scope']).toBe('write');
    expect(post['x-ews-errors']).toEqual(
      expect.arrayContaining([
        { status: 403, code: 'PAT_SCOPE_INSUFFICIENT' },
        { status: 409, code: 'TOPIC_KEY_TAKEN' },
      ]),
    );
  });

  it('quyền mở (self.read) không có FORBIDDEN / NOT_FOUND; route chỉ nhận phiên có SESSION_REQUIRED', () => {
    const create = op('/admin/me/tokens', 'post');
    const codes = (create['x-ews-errors'] as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain('SESSION_REQUIRED');
    expect(codes).not.toContain('FORBIDDEN');
    expect(codes).not.toContain('NOT_FOUND');
    expect(create['x-ews-session-only']).toBe(true);
  });

  it('/v1 dùng khoá app và lỗi khoá; /hooks không có security', () => {
    const send = op('/v1/notifications', 'post');
    expect(send['security']).toEqual([{ appKey: [] }]);
    expect((send['x-ews-errors'] as Array<{ code: string }>).map((e) => e.code)).toEqual(
      expect.arrayContaining(['API_KEY_REQUIRED', 'INVALID_API_KEY', 'APP_NOT_ACTIVE', 'IP_NOT_ALLOWED']),
    );
    expect(send['x-ews-permission']).toBeUndefined();
    expect(op('/hooks/{token}', 'post')['security']).toEqual([]);
  });

  it('nhánh union đặt tên bằng .meta({ title }) giữ title trong JSON Schema (trang Developer hiện tên thay "object")', () => {
    const union = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('path'), path: z.string() }).strict().meta({ title: 'PathMapping' }),
      z.object({ kind: z.literal('fixed'), value: z.string() }).strict().meta({ title: 'FixedMapping' }),
    ]);
    const schema = buildOpenApiDocument(
      [{ surface: 'admin', method: 'POST', url: '/admin/x', access: { permission: 'app.manage' }, doc: { tag: 'apps', summary: 'x', body: z.object({ m: z.array(union) }) } }],
      { serverUrl: null, version: '1' },
    );
    const body = (schema['paths'] as Record<string, Record<string, { requestBody: { content: Record<string, { schema: Record<string, any> }> } }>>)['/admin/x']!['post']!.requestBody.content['application/json']!.schema;
    const variants = (body['properties'].m.items.anyOf ?? body['properties'].m.items.oneOf) as Array<{ title?: string }>;
    expect(variants.map((v) => v.title)).toEqual(['PathMapping', 'FixedMapping']);
  });

  it('operationId không trùng', () => {
    const ids = Object.values(paths).flatMap((m) => Object.values(m).map((o) => o['operationId']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
