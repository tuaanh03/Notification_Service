import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../../src/modules/tenancy/infrastructure/db/schema.ts';
import { AccountId } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, tableNames, type TestDatabase } from './support/database.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.close();
});

describe('migration trên MySQL thật', () => {
  it('dựng đủ 27 bảng nghiệp vụ + bảng theo dõi migration', async () => {
    const tables = await tableNames(t.db);
    expect(tables).toContain('__drizzle_migrations');
    expect(tables.filter((name) => name !== '__drizzle_migrations')).toHaveLength(27);
  });

  it('chạy lại migrate trên DB đã migrate là no-op, không lỗi', async () => {
    await expect(migrate(t.db, { migrationsFolder: 'drizzle' })).resolves.toBeUndefined();
  });
});

// ADR-0002: DATETIME(3) + application luôn ghi UTC. Thiếu SET time_zone thì giá trị
// MySQL tự sinh (DEFAULT CURRENT_TIMESTAMP(3)) lệch theo cấu hình server.
describe('UTC ở mọi tầng', () => {
  it('session của mọi connection trong pool đặt time_zone = +00:00', async () => {
    const [rows] = (await t.db.execute(sql`SELECT @@session.time_zone AS tz`)) as unknown as [
      Array<{ tz: string }>,
    ];
    expect(rows[0]?.tz).toBe('+00:00');
  });

  // ADR-0017: ở REPEATABLE READ, "đọc -> khoá -> đọc lại" thấy snapshot cũ và phá mẫu khoá ADR-0009.
  it('mọi connection chạy READ COMMITTED', async () => {
    const [rows] = (await t.db.execute(sql`SELECT @@session.transaction_isolation AS iso`)) as unknown as [
      Array<{ iso: string }>,
    ];
    expect(rows[0]?.iso).toBe('READ-COMMITTED');
  });

  it('created_at do MySQL tự sinh khớp giờ UTC của application', async () => {
    const accountId = AccountId.create();
    const before = Date.now();
    await t.db.insert(accounts).values({ accountId, name: 'utc-check' });
    const [row] = await t.db.select().from(accounts).where(eq(accounts.accountId, accountId));
    // ±5 giây là đủ phân biệt với lệch múi giờ (tối thiểu vài chục phút).
    expect(Math.abs(row!.createdAt.getTime() - before)).toBeLessThan(5_000);
  });

  it('Date ghi vào đọc ra giữ nguyên tới mili giây', async () => {
    const accountId = AccountId.create();
    const at = new Date('2026-09-18T23:59:59.123Z');
    await t.db.insert(accounts).values({ accountId, name: 'roundtrip', createdAt: at, updatedAt: at });
    const [row] = await t.db.select().from(accounts).where(eq(accounts.accountId, accountId));
    expect(row!.createdAt.toISOString()).toBe(at.toISOString());
  });
});
