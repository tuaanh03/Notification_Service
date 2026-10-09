import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('dựng đủ 30 bảng nghiệp vụ + bảng theo dõi migration', async () => {
    const tables = await tableNames(t.db);
    expect(tables).toContain('__drizzle_migrations');
    expect(tables.filter((name) => name !== '__drizzle_migrations')).toHaveLength(30);
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

/**
 * 0008 (RBAC, ADR-0022) CHUYỂN dữ liệu, không chỉ đổi cấu trúc: dựng DB ở mốc 0007 với dữ liệu kiểu
 * cũ, rồi chạy tiếp tới bản mới nhất. MySQL strict mode từ chối thu hẹp enum khi còn giá trị cũ —
 * migration phải tự dọn trước, nếu không lệnh deploy production dừng giữa chừng.
 */
describe('0008 — chuyển dữ liệu sang RBAC', () => {
  let old: TestDatabase;
  let folder: string;
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'drizzle-0007-'));
    cpSync('drizzle', folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((e) => e.idx <= 7);
    writeFileSync(journalPath, JSON.stringify(journal));
    old = await createTestDatabase({ migrationsFolder: folder });
  });
  afterAll(async () => {
    await old?.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("mọi admin đang có -> super_admin; vai 'super_admin' cấp app bị bỏ, 'app_admin' giữ", async () => {
    const accountId = AccountId.create();
    await old.db.execute(sql`INSERT INTO accounts (account_id, name) VALUES (${accountId}, 'A')`);
    await old.db.execute(sql`INSERT INTO organizations (org_id, account_id, name) VALUES (${ORG}, ${accountId}, 'O')`);
    await old.db.execute(
      sql`INSERT INTO apps (app_id, org_id, account_id, slug, name, namespace) VALUES (${APP}, ${ORG}, ${accountId}, 'a', 'A', 'a')`,
    );
    for (const [id, role] of [[ADMIN_1, 'app_admin'], [ADMIN_2, 'super_admin']] as const) {
      await old.db.execute(sql`INSERT INTO admins (admin_id, account_id, email, role) VALUES (${id}, ${accountId}, ${id + '@t.local'}, ${role})`);
    }
    await old.db.execute(sql`INSERT INTO admin_app_roles (admin_id, app_id, account_id, role) VALUES
      (${ADMIN_1}, ${APP}, ${accountId}, 'app_admin'), (${ADMIN_2}, ${APP}, ${accountId}, 'super_admin')`);

    await migrate(old.db, { migrationsFolder: 'drizzle' });

    const [admins] = (await old.db.execute(sql`SELECT role FROM admins ORDER BY admin_id`)) as unknown as [{ role: string }[]];
    expect(admins.map((r) => r.role)).toEqual(['super_admin', 'super_admin']);
    const [roles] = (await old.db.execute(sql`SELECT admin_id AS adminId, role FROM admin_app_roles`)) as unknown as [
      { adminId: string; role: string }[],
    ];
    expect(roles).toEqual([{ adminId: ADMIN_1, role: 'app_admin' }]);
    expect(await tableNames(old.db)).toContain('org_members');
  });
});

const ORG = '00000000-0000-4000-8000-000000000001';
const APP = '00000000-0000-4000-8000-000000000002';
const ADMIN_1 = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_2 = '00000000-0000-4000-8000-0000000000a2';
