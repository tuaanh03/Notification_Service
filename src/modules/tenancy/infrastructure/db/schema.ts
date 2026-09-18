import { mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { ADMIN_ROLES } from '../../../../shared/kernel/enums.ts';
import { tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';

export const accounts = mysqlTable('accounts', {
  accountId: uuidPk('account_id'),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: tsNow('created_at'),
  updatedAt: tsNow('updated_at'),
});

/** Org = ranh giới sở hữu và hợp nhất person. */
export const organizations = mysqlTable(
  'organizations',
  {
    orgId: uuidPk('org_id'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.accountId),
    name: varchar('name', { length: 200 }).notNull(),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    // BẮT BUỘC: đích của composite FK fk_apps_org_account (ADR-0011).
    uniqueIndex('uq_organizations_org_account').on(t.orgId, t.accountId),
  ],
);

/** Admin = tầng truy cập, tách khỏi sở hữu. */
export const admins = mysqlTable(
  'admins',
  {
    adminId: uuidPk('admin_id'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.accountId),
    email: varchar('email', { length: 320 }).notNull(),
    role: mysqlEnum('role', ADMIN_ROLES).notNull().default('app_admin'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_admins_account_email').on(t.accountId, t.email),
    // BẮT BUỘC: đích của composite FK (admin_id, account_id) trên admin_app_roles (ADR-0011).
    uniqueIndex('uq_admins_admin_account').on(t.adminId, t.accountId),
  ],
);
