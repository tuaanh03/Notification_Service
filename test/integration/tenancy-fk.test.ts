import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAppRoles } from '../../src/modules/apps/infrastructure/db/schema.ts';
import { MYSQL_ERRORS, mysqlErrorCode } from '../../src/shared/db/index.ts';
import { AppId } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import {
  insertAccount,
  insertAdmin,
  insertApp,
  insertOrg,
  insertPerson,
  insertTenant,
  insertUser,
} from './support/fixtures.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.close();
});

/** DB phải TỪ CHỐI bằng lỗi FK — không phải lỗi nào khác (cú pháp, NOT NULL...) tình cờ làm test pass. */
async function expectFkRejection(write: Promise<unknown>): Promise<void> {
  const err = await write.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'write should have been rejected').not.toBeNull();
  expect(mysqlErrorCode(err)).toBe(MYSQL_ERRORS.NO_REFERENCED_ROW);
}

// Domain đã chặn trước (tenancy-isolation.test.ts). Ở đây kiểm lớp CUỐI: kể cả khi ai đó
// ghi SQL tay bỏ qua domain, MySQL vẫn không cho dữ liệu rò chéo org.
describe('composite FK trên users — chống rò rỉ chéo org', () => {
  it('user nối vào person CÙNG org thì ghi được', async () => {
    const { orgId, appId } = await insertTenant(t.db);
    const personId = await insertPerson(t.db, orgId);
    await expect(insertUser(t.db, { appId, orgId, personId })).resolves.toBeDefined();
  });

  it('fk_users_person_org: user nối vào person của org KHÁC bị từ chối', async () => {
    const a = await insertTenant(t.db);
    const b = await insertTenant(t.db);
    const personOfB = await insertPerson(t.db, b.orgId);
    await expectFkRejection(insertUser(t.db, { appId: a.appId, orgId: a.orgId, personId: personOfB }));
  });

  it('fk_users_app_org: user khai org khác với org của app bị từ chối', async () => {
    const a = await insertTenant(t.db);
    const b = await insertTenant(t.db);
    await expectFkRejection(insertUser(t.db, { appId: a.appId, orgId: b.orgId }));
  });
});

// ADR-0011: cùng loại lỗ, ở tầng quyền.
describe('composite FK trên apps / admin_app_roles — chống cấp quyền chéo account', () => {
  it('fk_apps_org_account: app khai account không sở hữu org bị từ chối', async () => {
    const x = await insertAccount(t.db);
    const y = await insertAccount(t.db);
    const orgOfX = await insertOrg(t.db, x);
    await expectFkRejection(insertApp(t.db, { orgId: orgOfX, accountId: y }));
  });

  it('admin và app cùng account thì cấp quyền được', async () => {
    const { accountId, appId } = await insertTenant(t.db);
    const adminId = await insertAdmin(t.db, accountId);
    await expect(
      t.db.insert(adminAppRoles).values({ adminId, appId, accountId, role: 'app_admin' }),
    ).resolves.toBeDefined();
  });

  it('admin của account X không được cấp quyền vào app của account Y — dù khai account nào', async () => {
    const x = await insertTenant(t.db);
    const y = await insertTenant(t.db);
    const adminOfX = await insertAdmin(t.db, x.accountId);

    // Khai account X: khớp admin nhưng lệch app -> fk_admin_app_roles_app_account chặn.
    await expectFkRejection(
      t.db.insert(adminAppRoles).values({
        adminId: adminOfX,
        appId: y.appId,
        accountId: x.accountId,
        role: 'app_admin',
      }),
    );
    // Khai account Y: khớp app nhưng lệch admin -> fk_admin_app_roles_admin_account chặn.
    await expectFkRejection(
      t.db.insert(adminAppRoles).values({
        adminId: adminOfX,
        appId: y.appId,
        accountId: y.accountId,
        role: 'app_admin',
      }),
    );
  });

  it('cấp quyền vào app không tồn tại bị từ chối', async () => {
    const { accountId } = await insertTenant(t.db);
    const adminId = await insertAdmin(t.db, accountId);
    await expectFkRejection(
      t.db.insert(adminAppRoles).values({ adminId, appId: AppId.create(), accountId, role: 'app_admin' }),
    );
  });
});

// ADR-0002 + ADR-0011: InnoDB cho phép FK trỏ tới index KHÔNG unique, nên xoá unique đích
// thì ràng buộc yếu đi mà không báo lỗi. Test này làm việc "báo lỗi" đó thay cho MySQL.
describe('unique index đích của composite FK phải còn nguyên', () => {
  const REQUIRED = [
    ['apps', 'uq_apps_app_org'],
    ['apps', 'uq_apps_app_account'],
    ['persons', 'uq_persons_person_org'],
    ['organizations', 'uq_organizations_org_account'],
    ['admins', 'uq_admins_admin_account'],
  ] as const;

  it.each(REQUIRED)('%s.%s tồn tại và là UNIQUE', async (table, index) => {
    const [rows] = (await t.pool.query(
      `SELECT non_unique AS nonUnique FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
      [table, index],
    )) as unknown as [Array<{ nonUnique: number | string }>];
    expect(rows, `${table}.${index} is missing`).toHaveLength(1);
    expect(Number(rows[0]!.nonUnique)).toBe(0);
  });
});
