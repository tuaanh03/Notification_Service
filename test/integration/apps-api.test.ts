import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { startApi, startWorker, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { outbox } from '../../src/shared/db/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { race } from './support/race.ts';
import { createTestRedis, eventually, testRedisUrl } from './support/redis.ts';

const ADMIN_TOKEN = 'test-admin-token-'.padEnd(40, 'x');

let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 12 });
  c = createContainer(
    loadEnv({
      DATABASE_URL: t.url,
      REDIS_URL: await testRedisUrl(),
      LOG_LEVEL: 'fatal',
      HOST: '127.0.0.1',
      PORT: '0',
      ADMIN_TOKEN,
    }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c);
  api = await startApi(c, application);
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

// --- client HTTP nhỏ cho test -------------------------------------------------
type Json = Record<string, any>;
async function http(method: string, path: string, opts: { token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? ADMIN_TOKEN : opts.token;
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${api.url}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json, headers: res.headers };
}
const admin = (method: string, path: string, body?: unknown) => http(method, `/admin${path}`, body === undefined ? {} : { body });

/** account -> org -> app (draft). */
async function newApp(slug: string) {
  const account = await admin('POST', '/accounts', { name: `Acc ${slug}` });
  const org = await admin('POST', `/accounts/${account.body['id']}/organizations`, { name: `Org ${slug}` });
  const created = await admin('POST', '/apps', { orgId: org.body['id'], slug, name: `App ${slug}`, namespace: slug });
  expect(created.status).toBe(201);
  return { orgId: org.body['id'] as string, appId: created.body['id'] as string };
}
async function activeApp(slug: string) {
  const ids = await newApp(slug);
  expect((await admin('POST', `/apps/${ids.appId}/submit`)).status).toBe(200);
  expect((await admin('POST', `/apps/${ids.appId}/approve`, { grantedChannels: ['email'] })).status).toBe(200);
  return ids;
}

describe('bề mặt /admin — xác thực', () => {
  it('thiếu / sai admin token -> 401 problem+json', async () => {
    const missing = await http('GET', '/admin/apps?orgId=00000000-0000-4000-8000-000000000000', { token: null });
    expect(missing.status).toBe(401);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    expect(missing.body['code']).toBe('INVALID_ADMIN_TOKEN');
    expect((await http('GET', '/admin/apps?orgId=x', { token: 'wrong'.padEnd(40, 'z') })).status).toBe(401);
  });

  it('ADMIN_TOKEN không cấu hình -> /admin đóng hoàn toàn', async () => {
    const closed = createContainer(loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }), {
      database: t,
      redis: await createTestRedis(),
    });
    const closedApi = await startApi(closed, buildApplication(closed));
    try {
      const res = await fetch(`${closedApi.url}/admin/accounts`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as Json)['code']).toBe('ADMIN_AUTH_DISABLED');
    } finally {
      await closedApi.stop();
      await closed.infra.redis.close();
    }
  });
});

describe('vòng đời app qua /admin', () => {
  it('draft -> pending_approval -> active kèm quyền cấp', async () => {
    const { appId } = await newApp('lifecycle');
    expect((await admin('GET', `/apps/${appId}`)).body).toMatchObject({ status: 'draft', grantedChannels: [] });
    expect((await admin('POST', `/apps/${appId}/submit`)).body['status']).toBe('pending_approval');
    const approved = await admin('POST', `/apps/${appId}/approve`, {
      grantedChannels: ['email', 'in_app'],
      rateLimitPerMinute: 120,
    });
    expect(approved.body).toMatchObject({ status: 'active', grantedChannels: ['email', 'in_app'], rateLimitPerMinute: 120 });
  });

  it('sai đường của state machine -> 409 INVALID_TRANSITION', async () => {
    const { appId } = await newApp('wrong-way');
    const res = await admin('POST', `/apps/${appId}/approve`, { grantedChannels: ['email'] });
    expect(res.status).toBe(409);
    expect(res.body['code']).toBe('INVALID_TRANSITION');
  });

  it('trùng slug trong cùng org -> 409 APP_SLUG_TAKEN; input sai định dạng -> 422 INVALID_FIELD có path', async () => {
    const { orgId } = await newApp('dup');
    const dup = await admin('POST', '/apps', { orgId, slug: 'dup', name: 'Again', namespace: 'dup-2' });
    expect(dup.status).toBe(409);
    expect(dup.body['code']).toBe('APP_SLUG_TAKEN');

    const bad = await admin('POST', '/apps', { orgId, slug: 'Has Spaces', name: 'x', namespace: 'ok-ns' });
    expect(bad.status).toBe(422);
    expect(bad.body['issues']).toEqual([expect.objectContaining({ code: 'INVALID_FIELD', path: 'slug' })]);
  });

  it('org không tồn tại -> 404', async () => {
    const res = await admin('POST', '/apps', {
      orgId: '00000000-0000-4000-8000-000000000000',
      slug: 'orphan',
      name: 'x',
      namespace: 'orphan',
    });
    expect(res.status).toBe(404);
  });
});

describe('API key và bề mặt /v1', () => {
  it('cấp key: plaintext trả ĐÚNG MỘT LẦN; danh sách chỉ có hint', async () => {
    const { appId } = await activeApp('keys');
    const issued = await admin('POST', `/apps/${appId}/secrets`);
    expect(issued.status).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    expect(issued.body['apiKey']).toMatch(/^ews_/);

    const listed = await admin('GET', `/apps/${appId}/secrets`);
    expect(listed.body).toEqual([expect.objectContaining({ id: issued.body['id'], hint: issued.body['hint'], status: 'active' })]);
    expect(JSON.stringify(listed.body)).not.toContain(issued.body['apiKey']);
    // Plaintext không bao giờ vào outbox -> không vào stream, không vào audit.
    const payloads = JSON.stringify(await t.db.select({ payload: outbox.payload }).from(outbox));
    expect(payloads).not.toContain(issued.body['apiKey']);
  });

  it('/v1/me: đúng key -> 200; thiếu -> 401 API_KEY_REQUIRED; sai -> 401 INVALID_API_KEY', async () => {
    const { appId } = await activeApp('v1-auth');
    const apiKey = (await admin('POST', `/apps/${appId}/secrets`)).body['apiKey'] as string;

    const me = await http('GET', '/v1/me', { token: apiKey });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ appId, slug: 'v1-auth', status: 'active', grantedChannels: ['email'] });

    expect((await http('GET', '/v1/me', { token: null })).body['code']).toBe('API_KEY_REQUIRED');
    // Admin token không mở được /v1 — hai bề mặt, hai loại credential.
    expect((await http('GET', '/v1/me', { token: ADMIN_TOKEN })).body['code']).toBe('INVALID_API_KEY');
  });

  it('allowlist IP: thêm rule IP khác -> 403; gỡ rule -> gọi lại được', async () => {
    const { appId } = await activeApp('allowlist');
    const apiKey = (await admin('POST', `/apps/${appId}/secrets`)).body['apiKey'] as string;

    expect((await admin('POST', `/apps/${appId}/network-rules`, { kind: 'ip', value: '10.9.9.9' })).status).toBe(201);
    const blocked = await http('GET', '/v1/me', { token: apiKey });
    expect(blocked.status).toBe(403);
    expect(blocked.body['code']).toBe('IP_NOT_ALLOWED');

    expect((await admin('DELETE', `/apps/${appId}/network-rules?kind=ip&value=10.9.9.9`)).status).toBe(204);
    expect((await http('GET', '/v1/me', { token: apiKey })).status).toBe(200);
  });

  it('thu hồi key -> key chết ngay; đình chỉ app -> 403 APP_NOT_ACTIVE', async () => {
    const { appId } = await activeApp('revoke');
    const first = (await admin('POST', `/apps/${appId}/secrets`)).body;
    const second = (await admin('POST', `/apps/${appId}/secrets`)).body;

    expect((await admin('DELETE', `/apps/${appId}/secrets/${first['id']}`)).body['status']).toBe('revoked');
    expect((await http('GET', '/v1/me', { token: first['apiKey'] })).body['code']).toBe('INVALID_API_KEY');
    expect((await http('GET', '/v1/me', { token: second['apiKey'] })).status).toBe(200);

    await admin('POST', `/apps/${appId}/suspend`, { reason: 'abuse report' });
    const suspended = await http('GET', '/v1/me', { token: second['apiKey'] });
    expect(suspended.status).toBe(403);
    expect(suspended.body['code']).toBe('APP_NOT_ACTIVE');
  });

  // ADR-0009 qua HTTP thật: 5 request song song, app đang có 1 key -> chỉ thêm được đúng 1.
  it('5 request cấp key song song -> vẫn tối đa 2 key active', async () => {
    const { appId } = await activeApp('race');
    await admin('POST', `/apps/${appId}/secrets`);

    const results = await race(5, () => admin('POST', `/apps/${appId}/secrets`));
    const responses = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(responses.filter((r) => r?.status === 201)).toHaveLength(1);
    const rejected = responses.filter((r) => r?.status === 422);
    expect(rejected).toHaveLength(4);
    expect(rejected.every((r) => r!.body['issues']?.[0]?.code === 'ACTIVE_SECRET_LIMIT')).toBe(true);

    const secrets = (await admin('GET', `/apps/${appId}/secrets`)).body as unknown as Json[];
    const active = secrets.filter((s) => s['status'] === 'active');
    expect(active).toHaveLength(2);
  });
});

// Consumer đầu tiên: command -> outbox -> relay -> audit.events -> worker (audit-writer) -> audit_log.
describe('audit end-to-end qua worker thật', () => {
  it('mọi thay đổi của app có mặt trong /admin/audit, đúng actor và source', async () => {
    const worker = await startWorker(c, consumerRegistry(application));
    try {
      const { appId } = await activeApp('audited');
      await admin('POST', `/apps/${appId}/secrets`);
      while ((await c.infra.outboxRelay.relayOnce()) > 0);

      let entries: Json[] = [];
      await eventually(async () => {
        entries = (await admin('GET', `/audit?targetType=App&targetId=${appId}`)).body as unknown as Json[];
        return entries.length >= 4;
      });
      expect(entries.map((e) => e['action']).sort()).toEqual(
        ['AppApproved', 'AppCreated', 'AppSecretIssued', 'AppSubmittedForReview'].sort(),
      );
      expect(entries.every((e) => e['actor'] === 'bootstrap-admin' && e['source'] === 'admin_api')).toBe(true);
      expect(entries.find((e) => e['action'] === 'AppApproved')).toMatchObject({
        before: { status: 'pending_approval' },
        after: { status: 'active', grantedChannels: ['email'] },
      });
    } finally {
      await worker.stop();
    }
  });
});
