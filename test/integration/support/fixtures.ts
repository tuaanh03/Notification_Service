import {
  AccountId,
  AdminId,
  AppId,
  OrgId,
  PersonId,
  UserId,
} from '../../../src/shared/kernel/index.ts';
import type { Executor } from '../../../src/shared/db/index.ts';
import { accounts, admins, organizations } from '../../../src/modules/tenancy/infrastructure/db/schema.ts';
import { apps } from '../../../src/modules/apps/infrastructure/db/schema.ts';
import { persons, users } from '../../../src/modules/directory/infrastructure/db/schema.ts';

/**
 * Insert thô thẳng vào bảng — cố ý KHÔNG đi qua entity: test tích hợp ở đây kiểm DB tự chặn
 * được dữ liệu sai, kể cả khi domain bị bỏ qua (ví dụ ai đó viết SQL tay).
 */
let seq = 0;
const next = () => (seq += 1);

export async function insertAccount(db: Executor): Promise<AccountId> {
  const accountId = AccountId.create();
  await db.insert(accounts).values({ accountId, name: `account-${next()}` });
  return accountId;
}

export async function insertOrg(db: Executor, accountId: AccountId): Promise<OrgId> {
  const orgId = OrgId.create();
  await db.insert(organizations).values({ orgId, accountId, name: `org-${next()}` });
  return orgId;
}

export async function insertApp(
  db: Executor,
  owner: { orgId: OrgId; accountId: AccountId },
): Promise<AppId> {
  const appId = AppId.create();
  const n = next();
  await db.insert(apps).values({
    appId,
    orgId: owner.orgId,
    accountId: owner.accountId,
    slug: `app-${n}`,
    name: `App ${n}`,
    namespace: `ns${n}`,
  });
  return appId;
}

export async function insertAdmin(db: Executor, accountId: AccountId): Promise<AdminId> {
  const adminId = AdminId.create();
  await db.insert(admins).values({ adminId, accountId, email: `admin${next()}@example.com` });
  return adminId;
}

export async function insertPerson(db: Executor, orgId: OrgId): Promise<PersonId> {
  const personId = PersonId.create();
  await db.insert(persons).values({ personId, orgId, primaryEmail: `person${next()}@example.com` });
  return personId;
}

export async function insertUser(
  db: Executor,
  row: { appId: AppId; orgId: OrgId; personId?: PersonId | null },
): Promise<UserId> {
  const userId = UserId.create();
  await db.insert(users).values({
    userId,
    appId: row.appId,
    orgId: row.orgId,
    externalId: `ext-${next()}`,
    personId: row.personId ?? null,
  });
  return userId;
}

/** Một account + một org + một app hợp lệ — điểm xuất phát chung của đa số test. */
export async function insertTenant(db: Executor): Promise<{
  accountId: AccountId;
  orgId: OrgId;
  appId: AppId;
}> {
  const accountId = await insertAccount(db);
  const orgId = await insertOrg(db, accountId);
  const appId = await insertApp(db, { orgId, accountId });
  return { accountId, orgId, appId };
}
