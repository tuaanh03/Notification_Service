import { eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../../src/composition/index.ts';
import { accounts } from '../../src/modules/tenancy/infrastructure/db/schema.ts';
import type { IntegrationEvent } from '../../src/shared/application/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { outbox, processedMessages } from '../../src/shared/db/index.ts';
import { AccountId, ValidationError } from '../../src/shared/kernel/index.ts';
import {
  decodeMessage,
  dlqOf,
  encodeOutboxRecord,
  OutboxRelay,
  PermanentMessageError,
  StreamClient,
  type ConsumerSpec,
  type MessageHandler,
  type RedisHandle,
  type StreamMessage,
} from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { race } from './support/race.ts';
import { createTestRedis, eventually, uniqueStream } from './support/redis.ts';

const AUDIT = uniqueStream('audit');
const WORK = uniqueStream('work');

let t: TestDatabase;
let redis: RedisHandle;
let c: Container;
beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 10 });
  redis = await createTestRedis();
  c = createContainer(
    loadEnv({ DATABASE_URL: 'mysql://unused/in-test', REDIS_URL: 'redis://unused', LOG_LEVEL: 'fatal' }),
    {
      database: t,
      redis,
      // Stream riêng cho file này, cùng luật với routeEvent thật: mọi event vào audit, một số vào thêm stream công việc.
      route: (e) => (e.eventType === 'WorkRequested' ? [AUDIT, WORK] : [AUDIT]),
    },
  );
});
afterAll(async () => {
  await c?.dispose();
});

class Boom extends Error {}

const event = (eventType: string, n: number): IntegrationEvent => ({
  aggregateType: 'Test',
  aggregateId: `agg-${n}`,
  eventType,
  payload: { n },
});
const emit = (...events: IntegrationEvent[]) => c.ports.uow.run(() => c.ports.outbox.append(events));
const read = async (stream: string): Promise<StreamMessage[]> =>
  (await c.infra.streams.range(stream)).map((e) => decodeMessage(stream, e.id, e.fields, 1));
const drain = async (relay = c.infra.outboxRelay) => {
  while ((await relay.relayOnce()) > 0);
};
const unpublished = () => t.db.select().from(outbox).where(isNull(outbox.publishedAt));

describe('outbox relay', () => {
  it('event đã commit được đẩy lên stream đúng nội dung, rồi đánh dấu published', async () => {
    await emit(event('SomethingHappened', 1));
    expect(await c.infra.outboxRelay.relayOnce()).toBe(1);

    const [message] = (await read(AUDIT)).slice(-1);
    expect(message).toMatchObject({ eventType: 'SomethingHappened', aggregateId: 'agg-1', payload: { n: 1 } });
    expect(message!.dedupKey).toMatch(/^outbox:\d+$/);
    expect(await unpublished()).toHaveLength(0);
    expect(await c.infra.outboxRelay.relayOnce()).toBe(0);
  });

  it('nghiệp vụ rollback -> không có gì để relay', async () => {
    const before = await c.infra.streams.length(AUDIT);
    await expect(
      c.ports.uow.run(async () => {
        await c.ports.outbox.append([event('SomethingHappened', 2)]);
        throw new Boom('rollback');
      }),
    ).rejects.toBeInstanceOf(Boom);
    await drain();
    expect(await c.infra.streams.length(AUDIT)).toBe(before);
  });

  it('một event, nhiều stream đích: audit + stream công việc', async () => {
    await emit(event('WorkRequested', 3));
    await drain();
    expect((await read(WORK)).map((m) => m.aggregateId)).toContain('agg-3');
    expect((await read(AUDIT)).map((m) => m.aggregateId)).toContain('agg-3');
  });

  it('giữ thứ tự ghi outbox trên stream', async () => {
    await emit(event('Ordered', 10), event('Ordered', 11), event('Ordered', 12));
    await drain();
    const ordered = (await read(AUDIT)).filter((m) => m.eventType === 'Ordered').map((m) => m.aggregateId);
    expect(ordered).toEqual(['agg-10', 'agg-11', 'agg-12']);
  });

  // SKIP LOCKED: relay song song lấy các lô khác nhau — không chờ nhau, không gửi trùng.
  it('4 relay song song trên 60 event: mỗi event lên stream ĐÚNG một lần', async () => {
    const stream = uniqueStream('parallel');
    const relayContainer = createContainer(c.env, {
      database: t,
      redis,
      route: () => [stream],
      outboxRelay: { batchSize: 7 },
    });
    await relayContainer.ports.uow.run(() =>
      relayContainer.ports.outbox.append(Array.from({ length: 60 }, (_, i) => event('Bulk', i))),
    );
    const results = await race(4, () => drain(relayContainer.infra.outboxRelay));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const keys = (await read(stream)).map((m) => m.dedupKey);
    expect(keys).toHaveLength(60);
    expect(new Set(keys).size).toBe(60);
    expect(await unpublished()).toHaveLength(0);
  });

  it('Redis chết: relay lỗi, event vẫn nằm trong outbox; Redis sống lại thì gửi tiếp — không mất', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    const deadRelay = new OutboxRelay({
      uow: c.ports.uow,
      transactions: c.infra.transactions,
      streams: new StreamClient(dead),
      clock: c.ports.clock,
      logger: c.ports.logger,
    });
    try {
      await emit(event('Survives', 20));
      await expect(deadRelay.relayOnce()).rejects.toThrow();
      expect((await unpublished()).map((r) => r.eventType)).toEqual(['Survives']);

      await drain();
      expect((await read(AUDIT)).map((m) => m.eventType)).toContain('Survives');
      expect(await unpublished()).toHaveLength(0);
    } finally {
      dead.disconnect();
    }
  });
});

describe('stream consumer', () => {
  let outboxSeq = 1_000_000;
  /** XADD thẳng một message đúng định dạng relay — kiểm soát được outbox id để giả lập gửi lặp. */
  const publish = (stream: string, n: number, outboxId = String(outboxSeq++)) =>
    c.infra.streams.add(
      stream,
      encodeOutboxRecord({
        outboxId,
        stream,
        eventType: 'Work',
        aggregateType: 'Test',
        aggregateId: `w-${n}`,
        payload: { n },
        createdAt: new Date(),
      }),
    );
  const consumerFor = async (stream: string, handler: MessageHandler, spec: Partial<ConsumerSpec> = {}) => {
    const consumer = c.infra.createConsumer({
      stream,
      group: `g-${stream}`,
      consumer: 'c1',
      handler,
      claimIdleMs: 0, // test không chờ 60 s mới nhận lại
      ...spec,
    });
    await consumer.ensureGroup();
    return consumer;
  };
  const pendingCount = (stream: string) => c.infra.streams.pending(stream, `g-${stream}`, 0, 100).then((p) => p.length);
  /** Handler ghi DB trong transaction của khung consumer — như command thật sẽ làm. */
  const insertAccount = (id: AccountId) =>
    c.infra.transactions.require('handler').insert(accounts).values({ accountId: id, name: 'from-handler' });
  const accountExists = async (id: AccountId) =>
    (await t.db.select().from(accounts).where(eq(accounts.accountId, id))).length === 1;

  it('xử lý message: handler commit cùng transaction, rồi ACK', async () => {
    const stream = uniqueStream('ok');
    const id = AccountId.create();
    const seen: StreamMessage[] = [];
    const consumer = await consumerFor(stream, async (m) => {
      seen.push(m);
      await insertAccount(id);
    });
    await publish(stream, 1);

    expect(await consumer.pollOnce(0)).toEqual({ processed: 1, duplicates: 0, retried: 0, deadLettered: 0 });
    expect(seen[0]).toMatchObject({ aggregateId: 'w-1', deliveryCount: 1 });
    expect(await accountExists(id)).toBe(true);
    expect(await pendingCount(stream)).toBe(0);
  });

  // Relay XADD lại sau commit hỏng -> hai message khác id, cùng outbox id.
  it('cùng event tới hai lần (khác message id, cùng dedupKey): handler chạy đúng một lần', async () => {
    const stream = uniqueStream('dup');
    let calls = 0;
    const consumer = await consumerFor(stream, async () => {
      calls += 1;
    });
    await publish(stream, 1, 'same-outbox-id');
    await publish(stream, 1, 'same-outbox-id');

    expect(await consumer.pollOnce(0)).toMatchObject({ processed: 1, duplicates: 1 });
    expect(calls).toBe(1);
    expect(await pendingCount(stream)).toBe(0);
  });

  it('lỗi tạm: không ACK, rollback phần handler đã ghi; lần giao lại xử lý thành công', async () => {
    const stream = uniqueStream('retry');
    const id = AccountId.create();
    let fail = true;
    const consumer = await consumerFor(stream, async (m) => {
      await insertAccount(id);
      if (fail) throw new Boom(`transient on delivery ${m.deliveryCount}`);
    });
    await publish(stream, 1);

    expect(await consumer.pollOnce(0)).toMatchObject({ retried: 1, processed: 0 });
    expect(await pendingCount(stream)).toBe(1);
    expect(await accountExists(id)).toBe(false); // rollback cả dấu processed_messages lẫn ghi của handler

    fail = false;
    expect(await consumer.reclaimOnce()).toMatchObject({ processed: 1 });
    expect(await accountExists(id)).toBe(true);
    expect(await pendingCount(stream)).toBe(0);
  });

  it.each([
    ['PermanentMessageError', () => new PermanentMessageError('bad reference')],
    ['DomainError (vi phạm invariant — tất định)', () => ValidationError.of('X', 'invariant broken')],
  ])('%s -> DLQ ngay, ACK bản gốc, không thử lại', async (_name, makeError) => {
    const stream = uniqueStream('perm');
    const consumer = await consumerFor(stream, async () => {
      throw makeError();
    });
    await publish(stream, 1);

    expect(await consumer.pollOnce(0)).toMatchObject({ deadLettered: 1 });
    expect(await pendingCount(stream)).toBe(0);
    const [dead] = await c.infra.streams.range(dlqOf(stream));
    const fields = new Map(chunk(dead!.fields));
    expect(fields.get('dlq_reason')).toBe('permanent_error');
    expect(fields.get('dlq_source_stream')).toBe(stream);
    expect(fields.get('aggregate_id')).toBe('w-1'); // message gốc đi nguyên vẹn vào DLQ để replay
  });

  it('message hỏng định dạng -> DLQ, không làm chết consumer', async () => {
    const stream = uniqueStream('malformed');
    const consumer = await consumerFor(stream, async () => undefined);
    await c.infra.streams.add(stream, ['garbage', 'yes']);
    await publish(stream, 2);

    expect(await consumer.pollOnce(0)).toMatchObject({ deadLettered: 1, processed: 1 });
  });

  it('lỗi tạm lặp lại: quá maxDeliveries lần thì vào DLQ', async () => {
    const stream = uniqueStream('exhaust');
    const consumer = await consumerFor(
      stream,
      async () => {
        throw new Boom('always');
      },
      { maxDeliveries: 3 },
    );
    await publish(stream, 1);

    await consumer.pollOnce(0); // lần giao 1
    await consumer.reclaimOnce(); // lần 2
    await consumer.reclaimOnce(); // lần 3
    expect(await consumer.reclaimOnce()).toMatchObject({ deadLettered: 1 });
    expect(await pendingCount(stream)).toBe(0);
    const [dead] = await c.infra.streams.range(dlqOf(stream));
    expect(new Map(chunk(dead!.fields)).get('dlq_reason')).toBe('max_deliveries');
  });

  it('end-to-end: command -> outbox -> relay -> stream -> run() -> handler', async () => {
    const received: StreamMessage[] = [];
    const consumer = await consumerFor(WORK, async (m) => {
      received.push(m);
    }, { blockMs: 200 });
    const controller = new AbortController();
    const running = consumer.run(controller.signal);

    await emit(event('WorkRequested', 99));
    await drain();
    await eventually(async () => received.some((m) => m.aggregateId === 'agg-99'));

    controller.abort();
    await running;
    expect(received.find((m) => m.aggregateId === 'agg-99')).toMatchObject({ eventType: 'WorkRequested' });
  });
});

// ADR-0016: handler gọi dịch vụ ngoài (gửi email) cần commit "đã nhận việc" TRƯỚC khi gọi ra ngoài.
describe("stream consumer — idempotency: 'handler'", () => {
  let outboxSeq = 2_000_000;
  const publish = (stream: string, n: number, outboxId = String(outboxSeq++)) =>
    c.infra.streams.add(
      stream,
      encodeOutboxRecord({
        outboxId,
        stream,
        eventType: 'Work',
        aggregateType: 'Test',
        aggregateId: `h-${n}`,
        payload: { n },
        createdAt: new Date(),
      }),
    );
  const consumerFor = async (stream: string, handler: MessageHandler, spec: Partial<ConsumerSpec> = {}) => {
    const consumer = c.infra.createConsumer({
      stream,
      group: `g-${stream}`,
      consumer: 'c1',
      handler,
      claimIdleMs: 0,
      idempotency: 'handler',
      ...spec,
    });
    await consumer.ensureGroup();
    return consumer;
  };
  const markers = (stream: string) =>
    t.db.select().from(processedMessages).where(eq(processedMessages.consumerGroup, `g-${stream}`));
  const insertAccount = (id: AccountId) =>
    c.infra.transactions.require('handler').insert(accounts).values({ accountId: id, name: 'handler-mode' });
  const accountExists = async (id: AccountId) =>
    (await t.db.select().from(accounts).where(eq(accounts.accountId, id))).length === 1;

  it('khung không mở transaction, không ghi processed_messages; handler tự commit được', async () => {
    const stream = uniqueStream('hm-ok');
    const id = AccountId.create();
    const consumer = await consumerFor(stream, async () => {
      // Không có transaction bao ngoài: uow.run này COMMIT ngay khi xong, độc lập với khung.
      await c.ports.uow.run(() => insertAccount(id));
    });
    await publish(stream, 1);

    expect(await consumer.pollOnce(0)).toMatchObject({ processed: 1 });
    expect(await accountExists(id)).toBe(true);
    expect(await markers(stream)).toHaveLength(0);
  });

  it('handler commit "đã nhận việc" rồi mới lỗi: phần đã commit GIỮ NGUYÊN, message vẫn được giao lại', async () => {
    const stream = uniqueStream('hm-claim');
    const claimed = AccountId.create();
    let calls = 0;
    const consumer = await consumerFor(stream, async () => {
      calls += 1;
      if (calls === 1) {
        await c.ports.uow.run(() => insertAccount(claimed)); // tx1: "nhận việc", commit
        throw new Boom('provider timed out'); // gọi ra ngoài thất bại SAU khi đã commit
      }
    });
    await publish(stream, 1);

    expect(await consumer.pollOnce(0)).toMatchObject({ retried: 1 });
    expect(await accountExists(claimed)).toBe(true); // khác chế độ framework: không bị rollback
    expect(await consumer.reclaimOnce()).toMatchObject({ processed: 1 });
    expect(calls).toBe(2);
  });

  // Khung không khử trùng ở chế độ này — handler PHẢI tự lo (ví dụ conditional update trên status).
  it('cùng event tới hai lần -> handler được gọi hai lần; handler tự nhận ra lần hai', async () => {
    const stream = uniqueStream('hm-dup');
    const done = new Set<string>();
    let sideEffects = 0;
    const consumer = await consumerFor(stream, async (m) => {
      if (done.has(m.dedupKey)) return; // giả lập "status không còn queued"
      done.add(m.dedupKey);
      sideEffects += 1;
    });
    await publish(stream, 1, 'same-outbox');
    await publish(stream, 1, 'same-outbox');

    expect(await consumer.pollOnce(0)).toMatchObject({ processed: 2, duplicates: 0 });
    expect(sideEffects).toBe(1);
  });

  it('lỗi vĩnh viễn vẫn vào DLQ như chế độ mặc định', async () => {
    const stream = uniqueStream('hm-perm');
    const consumer = await consumerFor(stream, async () => {
      throw new PermanentMessageError('rejected by provider');
    });
    await publish(stream, 1);

    expect(await consumer.pollOnce(0)).toMatchObject({ deadLettered: 1 });
    expect(await c.infra.streams.length(dlqOf(stream))).toBe(1);
  });
});

function chunk(fields: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) pairs.push([fields[i]!, fields[i + 1]!]);
  return pairs;
}
