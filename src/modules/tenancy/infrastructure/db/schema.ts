import { mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { ADMIN_ROLES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';

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
    // Không thừa: composite FK ở tầng dưới cần đúng index này làm đích.
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
  (t) => [uniqueIndex('uq_admins_account_email').on(t.accountId, t.email)],
);

/**
 * Admin chỉ chạm được app được cấp. Đây là RBAC thật —
 * tag `role:*` trên user không bao giờ thay thế được bảng này.
 */
export const adminAppRoles = mysqlTable(
  'admin_app_roles',
  {
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.adminId),
    appId: uuid('app_id').notNull(),
    role: mysqlEnum('role', ADMIN_ROLES).notNull(),
    grantedAt: tsNow('granted_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [primaryKey({ columns: [t.adminId, t.appId] })],
);
