import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { auditLog } from '../../src/modules/audit/infrastructure/db/schema.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { AccountId } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, signInAdmin, TEST_PASSWORD, type Json } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Nhật ký chung của Super Admin (`GET /admin/audit/events`): lọc theo loại sự kiện / người làm / thời gian, con trỏ
 * trang không trùng không sót, tổng số, email người làm, chỉ Super Admin. Dòng audit chèn thẳng vào bảng (worker ghi
 * audit đã có test riêng).
 */
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let token: string;
let adminId: string;
let accountId: string;

const BASE = new Date('2026-10-01T00:00:00.000Z');
const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60_000);

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 5 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c);
  api = await startApi(c, application);
  http = httpClient(api.url);
  const s = await signInAdmin(application, api.url, { email: 'root@test.local' });
  token = s.token;
  adminId = s.adminId;
  accountId = s.accountId;

  const row = (action: string, minutes: number, actor = adminId) => ({
    auditId: randomUUID(),
    actor,
    actorType: 'admin' as const,
    action,
    targetType: 'Admin',
    targetId: adminId,
    afterData: { n: minutes },
    source: 'admin_api',
    at: at(minutes),
  });
  // 5 LoginLocked (hai dòng CÙNG thời điểm — con trỏ phải phân xử bằng id), 2 LoginUnlocked, 1 của admin-cli.
  await t.db.insert(auditLog).values([
    row('LoginLocked', 1),
    row('LoginLocked', 2),
    row('LoginLocked', 3),
    row('LoginLocked', 3),
    row('LoginLocked', 4),
    row('LoginUnlocked', 5),
    row('LoginUnlocked', 6),
    row('AppSuspended', 7, 'admin-cli'),
  ]);
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const events = async (query: string) => (await http('GET', `/admin/audit/events?${query}`, { token })).body;

describe('GET /admin/audit/events', () => {
  it('lọc theo khoảng thời gian, mới nhất trước, gắn email người làm; id không phải tài khoản thì email null', async () => {
    const page = await events(`from=${at(0).toISOString()}&to=${at(60).toISOString()}`);
    // Bảng còn dòng audit thật (đăng nhập lúc dựng test) — giới hạn bằng khoảng thời gian của dữ liệu mẫu.
    expect(page['total']).toBe(8);
    const items = page['items'] as Json[];
    expect(items.map((i) => i['action'])).toEqual([
      'AppSuspended',
      'LoginUnlocked',
      'LoginUnlocked',
      'LoginLocked',
      'LoginLocked',
      'LoginLocked',
      'LoginLocked',
      'LoginLocked',
    ]);
    expect(items[1]).toMatchObject({ actor: adminId, actorEmail: 'root@test.local', targetEmail: 'root@test.local' });
    expect(items[0]).toMatchObject({ actor: 'admin-cli', actorEmail: null });
  });

  it('lọc nhiều loại sự kiện; con trỏ đi hết trang không trùng không sót (kể cả hai dòng cùng thời điểm)', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await events(`action=LoginLocked,LoginUnlocked&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(page['total']).toBe(7);
      seen.push(...(page['items'] as Json[]).map((i) => i['id'] as string));
      cursor = page['nextCursor'] as string | null;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('lọc theo người làm', async () => {
    expect((await events('actor=admin-cli'))['total']).toBe(1);
  });

  it('tham số sai -> 422; người không phải Super Admin -> 403', async () => {
    expect((await http('GET', '/admin/audit/events?from=hom-qua', { token })).status).toBe(422);
    expect((await http('GET', '/admin/audit/events?limit=999', { token })).status).toBe(422);
    const ctx = { actor: { id: 'test', type: 'admin' as const }, source: 'system' as const };
    await application.adminOps.createAdmin.execute(
      { accountId: AccountId.parse(accountId), email: 'user@test.local', password: TEST_PASSWORD, role: 'user' },
      ctx,
    );
    const login = await http('POST', '/auth/login', { body: { email: 'user@test.local', password: TEST_PASSWORD } });
    expect((await http('GET', '/admin/audit/events', { token: login.body['token'] as string })).status).toBe(403);
  });
});
