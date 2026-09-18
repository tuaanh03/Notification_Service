import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../../src/composition/index.ts';
import { AppSecret } from '../../src/modules/apps/domain/entities/app-secret.ts';
import { appSecrets, apps } from '../../src/modules/apps/infrastructure/db/schema.ts';
import { accounts } from '../../src/modules/tenancy/infrastructure/db/schema.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import {
  lockParentRow,
  outbox,
  processedMessages,
  TransactionRequiredError,
} from '../../src/shared/db/index.ts';
import { AccountId, AppId, AppSecretId, ValidationError } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { insertTenant } from './support/fixtures.ts';
import { fulfilled, race, rejected } from './support/race.ts';

const PARALLEL = 5;

let t: TestDatabase;
let c: Container;
beforeAll(async () => {
  // Pool >= số lệnh song song, nếu không các lệnh xếp hàng chờ connection và race không còn là race.
  t = await createTestDatabase({ poolSize: PARALLEL + 2 });
  c = createContainer(loadEnv({ DATABASE_URL: 'mysql://unused/in-test', REDIS_URL: 'redis://unused', LOG_LEVEL: 'fatal' }), {
    database: t,
  });
});
afterAll(async () => {
  await c?.dispose();
});

class Boom extends Error {}

/** Truy vấn phụ trợ của test chạy thẳng trên db, ngoài mọi transaction. */
const db = () => t.db;
const tx = () => c.infra.transactions.require('test');

describe('UnitOfWork (port) — application không thấy transaction', () => {
  it('commit: mọi thay đổi trong work cùng được ghi', async () => {
    const accountId = AccountId.create();
    await c.ports.uow.run(() => tx().insert(accounts).values({ accountId, name: 'committed' }));
    expect(await db().select().from(accounts).where(eq(accounts.accountId, accountId))).toHaveLength(1);
  });

  it('work throw: ROLLBACK toàn bộ và ném lại đúng lỗi gốc', async () => {
    const accountId = AccountId.create();
    await expect(
      c.ports.uow.run(async () => {
        await tx().insert(accounts).values({ accountId, name: 'rolled-back' });
        throw new Boom('fail after write');
      }),
    ).rejects.toBeInstanceOf(Boom);
    expect(await db().select().from(accounts).where(eq(accounts.accountId, accountId))).toHaveLength(0);
  });

  it('run lồng nhau nhập vào transaction ngoài: lỗi ở ngoài rollback cả phần bên trong', async () => {
    const inner = AccountId.create();
    await expect(
      c.ports.uow.run(async () => {
        await c.ports.uow.run(() => tx().insert(accounts).values({ accountId: inner, name: 'inner' }));
        throw new Boom('outer fails');
      }),
    ).rejects.toBeInstanceOf(Boom);
    expect(await db().select().from(accounts).where(eq(accounts.accountId, inner))).toHaveLength(0);
  });

  it('hai run song song có hai transaction riêng — không rò transaction sang nhau', async () => {
    const ok = AccountId.create();
    const failed = AccountId.create();
    const results = await Promise.allSettled([
      c.ports.uow.run(() => tx().insert(accounts).values({ accountId: ok, name: 'ok' })),
      c.ports.uow.run(async () => {
        await tx().insert(accounts).values({ accountId: failed, name: 'failed' });
        throw new Boom('only this one');
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(await db().select().from(accounts).where(eq(accounts.accountId, ok))).toHaveLength(1);
    expect(await db().select().from(accounts).where(eq(accounts.accountId, failed))).toHaveLength(0);
  });
});

describe('EventOutbox (port)', () => {
  const event = (aggregateId: string) => ({
    aggregateType: 'App',
    aggregateId,
    eventType: 'AppApproved',
    payload: { appId: aggregateId, note: 'ghi chú có dấu' },
  });

  it('event đi cùng transaction: commit thì có, payload JSON giữ nguyên, stream do router quyết', async () => {
    const id = AppId.create();
    await c.ports.uow.run(() => c.ports.outbox.append([event(id)]));
    const rows = await db().select().from(outbox).where(eq(outbox.aggregateId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual(event(id).payload);
    expect(rows[0]!.stream).toBe('audit.events');
    expect(rows[0]!.publishedAt).toBeNull();
  });

  // Đây là lý do outbox tồn tại: không có cảnh "nghiệp vụ rollback nhưng event vẫn đi".
  it('nghiệp vụ rollback thì event cũng biến mất', async () => {
    const id = AppId.create();
    await expect(
      c.ports.uow.run(async () => {
        await c.ports.outbox.append([event(id)]);
        throw new Boom('business rule failed');
      }),
    ).rejects.toBeInstanceOf(Boom);
    expect(await db().select().from(outbox).where(eq(outbox.aggregateId, id))).toHaveLength(0);
  });

  it('gọi ngoài UnitOfWork.run bị từ chối', async () => {
    await expect(c.ports.outbox.append([event(AppId.create())])).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });
});

describe('ProcessedMessageStore — chốt idempotent của consumer', () => {
  const mark = (group: string, id: string) =>
    c.ports.uow.run(() => c.infra.processedMessages.markProcessed(group, id));

  it('lần đầu trả true, message giao lại trả false', async () => {
    expect(await mark('resolver', '1-0')).toBe(true);
    expect(await mark('resolver', '1-0')).toBe(false);
  });

  it('cùng message id nhưng khác consumer group là hai lần xử lý độc lập', async () => {
    expect(await mark('group-a', '2-0')).toBe(true);
    expect(await mark('group-b', '2-0')).toBe(true);
  });

  it('handler lỗi thì dấu "đã xử lý" rollback theo — lần giao lại được xử lý lại', async () => {
    await expect(
      c.ports.uow.run(async () => {
        await c.infra.processedMessages.markProcessed('resolver', '3-0');
        throw new Boom('handler failed');
      }),
    ).rejects.toBeInstanceOf(Boom);
    const rows = await db()
      .select()
      .from(processedMessages)
      .where(and(eq(processedMessages.consumerGroup, 'resolver'), eq(processedMessages.messageId, '3-0')));
    expect(rows).toHaveLength(0);
    expect(await mark('resolver', '3-0')).toBe(true);
  });

  it('giao trùng song song: đúng một consumer thắng', async () => {
    const results = await race(PARALLEL, () => mark('resolver', '4-0'));
    expect(rejected(results)).toEqual([]);
    expect(fulfilled(results).filter(Boolean)).toHaveLength(1);
  });

  it('gọi ngoài UnitOfWork.run bị từ chối', async () => {
    await expect(c.infra.processedMessages.markProcessed('resolver', '5-0')).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });
});

// ADR-0009: "≤ 2 secret active" không ép được ở MySQL -> khoá dòng cha rồi mới đếm.
// Đây là test của MẪU khoá (helper + domain guard); command thật thuộc module apps (lượt 4).
describe('lockParentRow — tuần tự hoá trên dòng cha', () => {
  async function addActiveSecret(appId: AppId): Promise<void> {
    await c.ports.uow.run(async () => {
      if (!(await lockParentRow(tx(), apps, apps.appId, appId))) throw new Error('app not found');
      const [row] = await tx()
        .select({ n: count() })
        .from(appSecrets)
        .where(and(eq(appSecrets.appId, appId), eq(appSecrets.status, 'active')));
      AppSecret.assertCanAddActive(row?.n ?? 0);
      const appSecretId = AppSecretId.create();
      await tx().insert(appSecrets).values({
        appSecretId,
        appId,
        secretHash: `hash-${appSecretId}`,
        hint: `hint-${appSecretId.slice(0, 8)}`,
      });
    });
  }

  it('dòng cha không tồn tại -> false', async () => {
    expect(await c.ports.uow.run(() => lockParentRow(tx(), apps, apps.appId, AppId.create()))).toBe(false);
  });

  it(`${PARALLEL} lệnh thêm secret song song trên app đang có 1 secret -> vẫn chỉ 2 active`, async () => {
    const { appId } = await insertTenant(db());
    await addActiveSecret(appId);

    const results = await race(PARALLEL, () => addActiveSecret(appId));

    expect(fulfilled(results)).toHaveLength(1);
    const errors = rejected(results);
    expect(errors).toHaveLength(PARALLEL - 1);
    // Mọi lệnh thua phải thua vì guard của domain — không phải deadlock hay lock timeout.
    for (const err of errors) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues[0]?.code).toBe('ACTIVE_SECRET_LIMIT');
    }
    const [active] = await db()
      .select({ n: count() })
      .from(appSecrets)
      .where(and(eq(appSecrets.appId, appId), eq(appSecrets.status, 'active')));
    expect(active?.n).toBe(2);
  });
});
