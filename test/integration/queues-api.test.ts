import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, consumerRegistry, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { dlqOf, encodeOutboxRecord, STREAMS } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, signInAdmin, type Json } from './support/http.ts';
import { createTestRedis, eventually, testRedisUrl } from './support/redis.ts';

/**
 * Màn quản trị hàng đợi (ADR-0042): mọi consumer group kèm số đo + thông số, message lỗi (DLQ) đẩy lại / bỏ, tạm dừng một
 * group (vòng lặp worker thật ngừng lấy message), audit cho mọi thao tác ghi.
 */
let ADMIN_TOKEN: string;
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 8 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c, { emailProvider: new MockEmailProvider({ logger: c.ports.logger }) });
  api = await startApi(c, application);
  ADMIN_TOKEN = (await signInAdmin(application, api.url)).token;
  http = httpClient(api.url);
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const admin = (method: string, path: string, body?: unknown) =>
  http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });

/** Message đúng khuôn outbox cho một notification KHÔNG tồn tại — worker gửi email bỏ qua (`skipped`) và ACK. */
const harmless = () =>
  encodeOutboxRecord({
    outboxId: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
    stream: STREAMS.NOTIF_QUEUED,
    eventType: 'NotificationQueued',
    aggregateType: 'Notification',
    aggregateId: randomUUID(),
    payload: {},
    createdAt: new Date(),
  });

/** Giả một message đã vào DLQ của `notif.queued` (đúng khuôn field `dlq_*` của khung consumer). */
const deadLetter = (reason = 'permanent_error') =>
  c.infra.streams.add(dlqOf(STREAMS.NOTIF_QUEUED), [
    ...harmless(),
    'dlq_source_stream', STREAMS.NOTIF_QUEUED,
    'dlq_source_id', '1-0',
    'dlq_group', 'email-sender',
    'dlq_reason', reason,
    'dlq_error', 'boom',
    'dlq_deliveries', '1',
  ]);

const groupOf = async (group: string) =>
  ((await admin('GET', '/queues')).body['groups'] as Json[]).find((g) => g['group'] === group)!;

describe('GET /admin/queues', () => {
  it('mọi consumer group đang khai, kèm thông số đã gộp mặc định; nhật ký hệ thống không cho tạm dừng', async () => {
    const res = await admin('GET', '/queues');
    expect(res.status).toBe(200);
    const groups = res.body['groups'] as Json[];
    expect(groups.map((g) => g['group']).sort()).toEqual(
      consumerRegistry(application).map((r) => r.group).sort(),
    );
    expect(groups.find((g) => g['group'] === 'email-sender-priority')).toMatchObject({
      stream: STREAMS.NOTIF_QUEUED_PRIORITY,
      pausable: true,
      paused: false,
      options: { batchSize: 32, maxDeliveries: 5, claimIdleMs: 60_000, idempotency: 'handler' },
    });
    expect(groups.find((g) => g['group'] === 'audit-writer')).toMatchObject({ pausable: false });
    expect((res.body['redis'] as Json)['usedMemoryBytes']).toBeGreaterThan(0);
  });

  it('chỉ Super Admin', async () => {
    expect((await http('GET', '/admin/queues', {})).status).toBe(401);
  });
});

describe('Message lỗi (DLQ)', () => {
  it('liệt kê -> đẩy lại về stream gốc (bỏ field dlq_*), worker xử lý xong; audit DeadLetterRequeued', async () => {
    const id = await deadLetter();
    const list = await admin('GET', `/queues/dead-letters?stream=${STREAMS.NOTIF_QUEUED}`);
    const item = (list.body['items'] as Json[]).find((d) => d['id'] === id)!;
    expect(item).toMatchObject({ stream: STREAMS.NOTIF_QUEUED, group: 'email-sender', reason: 'permanent_error', deliveries: 1, eventType: 'NotificationQueued' });
    expect(item).not.toHaveProperty('payload');
    expect((await groupOf('email-sender'))['deadLetters']).toBeGreaterThanOrEqual(1);

    const res = await admin('POST', `/queues/dead-letters/${STREAMS.NOTIF_QUEUED}/${id}/requeue`);
    expect(res.status).toBe(200);
    const newId = res.body['id'] as string;
    const requeued = await c.infra.streams.get(STREAMS.NOTIF_QUEUED, newId);
    expect(requeued?.fields).not.toContain('dlq_reason');
    expect(requeued?.fields).toContain('NotificationQueued');
    expect(await c.infra.streams.get(dlqOf(STREAMS.NOTIF_QUEUED), id)).toBeNull();

    // Lần thứ hai: không còn trong DLQ.
    expect((await admin('POST', `/queues/dead-letters/${STREAMS.NOTIF_QUEUED}/${id}/requeue`)).status).toBe(404);

    // Worker gửi email thật xử lý message được đẩy lại (notification không tồn tại -> bỏ qua, ACK, không vào DLQ lần nữa).
    const r = consumerRegistry(application).find((x) => x.group === 'email-sender')!;
    const worker = c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 50 });
    await worker.ensureGroup();
    while ((await worker.pollOnce(0)).processed > 0);
    expect((await admin('GET', `/queues/dead-letters?stream=${STREAMS.NOTIF_QUEUED}`)).body['items']).toEqual([]);

    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    const audit = await c.infra.streams.range(STREAMS.AUDIT_EVENTS, 10_000);
    expect(audit.some((e) => e.fields.includes('DeadLetterRequeued') && e.fields.join(' ').includes(id))).toBe(true);
  });

  it('bỏ: bắt buộc lý do; xong thì không còn; stream lạ / id lạ -> 404', async () => {
    const id = await deadLetter('max_deliveries');
    const path = `/queues/dead-letters/${STREAMS.NOTIF_QUEUED}/${id}/discard`;
    const empty = await admin('POST', path, { reason: '  ' });
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.body)).toContain('DISCARD_REASON_REQUIRED');
    expect((await admin('POST', path, { reason: 'Thư kiểm thử, không cần gửi' })).status).toBe(204);
    expect((await admin('POST', path, { reason: 'lần hai' })).status).toBe(404);
    expect((await admin('POST', `/queues/dead-letters/khong.ton.tai/${id}/discard`, { reason: 'x' })).status).toBe(404);
    expect((await admin('POST', `/queues/dead-letters/${STREAMS.NOTIF_QUEUED}/abc/discard`, { reason: 'x' })).status).toBe(422);

    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    const audit = await c.infra.streams.range(STREAMS.AUDIT_EVENTS, 10_000);
    expect(audit.some((e) => e.fields.includes('DeadLetterDiscarded') && e.fields.join(' ').includes('Thư kiểm thử'))).toBe(true);
  });
});

describe('Tạm dừng một group', () => {
  it('đang dừng: vòng lặp worker thật không lấy message; chạy lại thì xử lý; nhật ký hệ thống -> 422', async () => {
    expect((await admin('PUT', '/queues/groups/email-sender-priority/pause', { paused: true })).body).toEqual({ paused: true });
    expect((await groupOf('email-sender-priority'))['paused']).toBe(true);

    await c.infra.streams.add(STREAMS.NOTIF_QUEUED_PRIORITY, harmless());
    const r = consumerRegistry(application).find((x) => x.group === 'email-sender-priority')!;
    const worker = c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'loop', handler: r.handler, blockMs: 100 });
    await worker.ensureGroup();
    const controller = new AbortController();
    const running = worker.run(controller.signal);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect((await groupOf('email-sender-priority'))['lag']).toBe(1);

      expect((await admin('PUT', '/queues/groups/email-sender-priority/pause', { paused: false })).body).toEqual({ paused: false });
      await eventually(async () => (await groupOf('email-sender-priority'))['lag'] === 0);
    } finally {
      controller.abort();
      await running;
    }

    const audit = await admin('PUT', '/queues/groups/audit-writer/pause', { paused: true });
    expect(audit.status).toBe(422);
    expect(JSON.stringify(audit.body)).toContain('CONSUMER_NOT_PAUSABLE');
    expect((await admin('PUT', '/queues/groups/khong-co/pause', { paused: true })).status).toBe(404);

    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    const events = (await c.infra.streams.range(STREAMS.AUDIT_EVENTS, 10_000)).flatMap((e) => e.fields);
    expect(events).toContain('ConsumerGroupPaused');
    expect(events).toContain('ConsumerGroupResumed');
  });
});
