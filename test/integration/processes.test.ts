import { spawn } from 'node:child_process';
import { lt, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import {
  buildApplication,
  createContainer,
  schedulerJobs,
  type ConsumerRegistration,
  type Container,
} from '../../src/composition/index.ts';
import { startApi, startScheduler, startWorker } from '../../src/entrypoints/index.ts';
import type { IntegrationEvent } from '../../src/shared/application/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { outbox, processedMessages } from '../../src/shared/db/index.ts';
import { ValidationError } from '../../src/shared/kernel/index.ts';
import { createRedis, type StreamMessage } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { createTestRedis, eventually, uniqueStream } from './support/redis.ts';

const STREAM = uniqueStream('proc');

let t: TestDatabase;
let c: Container;
const envFor = (extra: Record<string, string> = {}) =>
  loadEnv({ DATABASE_URL: t.url, REDIS_URL: inject('redisUrl'), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0', ...extra });

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 10 });
  c = createContainer(envFor(), { database: t, redis: createTestRedis(), route: () => [STREAM] });
});
afterAll(async () => {
  await c?.dispose();
});

const emit = (...events: IntegrationEvent[]) => c.ports.uow.run(() => c.ports.outbox.append(events));
const event = (n: number): IntegrationEvent => ({ aggregateType: 'Test', aggregateId: `p-${n}`, eventType: 'Ping', payload: { n } });

describe('process api', () => {
  it('health: live luôn 200; ready kiểm MySQL + Redis', async () => {
    const api = await startApi(c, buildApplication(c));
    try {
      expect((await fetch(`${api.url}/health/live`)).status).toBe(200);
      const ready = await fetch(`${api.url}/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: 'ok', checks: { mysql: 'ok', redis: 'ok' } });
    } finally {
      await api.stop();
    }
  });

  it('ready -> 503 và chỉ ra phụ thuộc hỏng khi Redis không tới được', async () => {
    const dead = createRedis({ url: 'redis://127.0.0.1:1' });
    dead.client.options.maxRetriesPerRequest = 0;
    dead.client.options.retryStrategy = () => null;
    const broken = createContainer(envFor(), { database: t, redis: dead });
    const api = await startApi(broken, buildApplication(broken));
    try {
      const ready = await fetch(`${api.url}/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ checks: { mysql: 'ok', redis: 'fail' } });
    } finally {
      await api.stop();
      dead.client.disconnect();
    }
  });

  it('mọi lỗi thành problem+json: route không có -> 404, vi phạm domain -> 422 kèm issues', async () => {
    const api = await startApi(c, buildApplication(c), {
      extraSurfaces: { public: [
        (app) => {
          app.post('/test/fail', async () => {
            throw ValidationError.of('APP_NAME_REQUIRED', 'app name must not be empty', 'name');
          });
        },
      ] },
    });
    try {
      const missing = await fetch(`${api.url}/nope`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('application/problem+json');
      expect(await missing.json()).toMatchObject({ code: 'NOT_FOUND' });

      const invalid = await fetch(`${api.url}/test/fail`, { method: 'POST' });
      expect(invalid.status).toBe(422);
      expect(await invalid.json()).toMatchObject({ code: 'VALIDATION', issues: [{ code: 'APP_NAME_REQUIRED', path: 'name' }] });
      expect(invalid.headers.get('x-request-id')).toBeTruthy();
    } finally {
      await api.stop();
    }
  });

  it('POST không body nhưng có Content-Type: application/json -> vẫn tới route; JSON hỏng -> 400 MALFORMED_JSON', async () => {
    const api = await startApi(c, buildApplication(c), {
      extraSurfaces: { public: [(app) => void app.post('/test/echo', async (request) => ({ body: request.body ?? null }))] },
    });
    try {
      const json = { 'content-type': 'application/json' };
      const empty = await fetch(`${api.url}/test/echo`, { method: 'POST', headers: json });
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({ body: null });

      const broken = await fetch(`${api.url}/test/echo`, { method: 'POST', headers: json, body: '{oops' });
      expect(broken.status).toBe(400);
      expect(await broken.json()).toMatchObject({ code: 'MALFORMED_JSON' });
    } finally {
      await api.stop();
    }
  });

  it('stop(): đợi request đang chạy xong rồi mới đóng — không cắt ngang', async () => {
    let finished = false;
    const api = await startApi(c, buildApplication(c), {
      extraSurfaces: { public: [
        (app) => {
          app.get('/test/slow', async () => {
            await new Promise((r) => setTimeout(r, 300));
            finished = true;
            return { ok: true };
          });
        },
      ] },
    });
    const inFlight = fetch(`${api.url}/test/slow`);
    await new Promise((r) => setTimeout(r, 50));
    await api.stop();
    expect(finished).toBe(true);
    expect((await inFlight).status).toBe(200);
  });
});

describe('process worker', () => {
  it('chạy consumer đã đăng ký: event từ outbox tới được handler; stop() dừng gọn', async () => {
    const received: StreamMessage[] = [];
    const registry: ConsumerRegistration[] = [
      { group: 'test-group', stream: STREAM, handler: async (m) => void received.push(m), options: { blockMs: 100 } },
    ];
    const worker = await startWorker(c, registry);
    try {
      await emit(event(1));
      while ((await c.infra.outboxRelay.relayOnce()) > 0);
      await eventually(async () => received.some((m) => m.aggregateId === 'p-1'));
    } finally {
      await worker.stop();
    }
  });

  it('WORKER_GROUPS gõ sai -> không khởi động được', async () => {
    const container = createContainer(envFor({ WORKER_GROUPS: 'typo-group' }), { database: t, redis: createTestRedis() });
    try {
      await expect(startWorker(container, [])).rejects.toThrow(/unknown WORKER_GROUPS: typo-group/);
    } finally {
      await container.infra.redis.close();
    }
  });
});

describe('process scheduler', () => {
  it('relay outbox theo nhịp: event đã commit tự lên stream, không ai phải gọi relay', async () => {
    const scheduler = await startScheduler(c, [], { relayEveryMs: 50, cleanupEveryMs: 60_000 });
    try {
      await emit(event(2));
      await eventually(async () => (await c.infra.streams.range(STREAM)).some((e) => e.fields.includes('p-2')));
    } finally {
      await scheduler.stop();
    }
  });

  it('dọn dẹp: xoá outbox đã publish quá 7 ngày + processed_messages quá 14 ngày; KHÔNG đụng dòng chưa publish', async () => {
    const now = c.ports.clock.now();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    await t.db.insert(outbox).values([
      { aggregateType: 'T', aggregateId: 'old', eventType: 'Old', stream: STREAM, payload: {}, publishedAt: daysAgo(8) },
      { aggregateType: 'T', aggregateId: 'recent', eventType: 'Recent', stream: STREAM, payload: {}, publishedAt: daysAgo(1) },
      // Chưa publish, dù rất cũ: xoá nó là mất event.
      { aggregateType: 'T', aggregateId: 'stuck', eventType: 'Stuck', stream: 'never.relayed', payload: {}, createdAt: daysAgo(30) },
    ]);
    await t.db.insert(processedMessages).values([
      { consumerGroup: 'g', messageId: 'old', at: daysAgo(15) },
      { consumerGroup: 'g', messageId: 'recent', at: daysAgo(1) },
    ]);

    for (const job of schedulerJobs(c).filter((j) => j.name.startsWith('purge-'))) await job.run();

    const ids = (await t.db.select({ id: outbox.aggregateId }).from(outbox)).map((r) => r.id);
    expect(ids).not.toContain('old');
    expect(ids).toEqual(expect.arrayContaining(['recent', 'stuck']));
    expect(await t.db.select().from(outbox).where(isNull(outbox.publishedAt))).toHaveLength(1);
    expect(await t.db.select().from(processedMessages).where(lt(processedMessages.at, daysAgo(14)))).toHaveLength(0);
    expect((await t.db.select().from(processedMessages)).map((r) => r.messageId)).toContain('recent');
  });
});

// Chạy process THẬT (tsx) như trong container: khởi động, nhận SIGTERM, thoát sạch với mã 0.
describe.each(['api', 'worker', 'scheduler'])('process thật: %s', (name) => {
  it('khởi động, SIGTERM -> tắt gọn, exit code 0', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', `src/entrypoints/${name}/main.ts`], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: t.url,
        REDIS_URL: inject('redisUrl'),
        LOG_LEVEL: 'info',
        HOST: '127.0.0.1',
        PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));

    try {
      await eventually(async () => output.includes('"msg":"started"'), 20_000);
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
      expect(output).toContain('"msg":"shutting down"');
      expect(output).toContain('"msg":"stopped"');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 40_000);
});
