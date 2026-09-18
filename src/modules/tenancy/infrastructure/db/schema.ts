import { foreignKey, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { ADMIN_ROLES } from '../../../../shared/kernel/enums.ts';
import { ts, tsNow, uuid, uuidPk } from '../../../../shared/db/columns.ts';
// Import vòng có chủ đích với apps/schema.ts (apps tham chiếu organizations). An toàn vì Drizzle
// chỉ đọc tham chiếu FK một cách lazy — không bảng nào chạm biến của module kia lúc khởi tạo.
import { apps } from '../../../apps/infrastructure/db/schema.ts';

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

/**
 * Admin chỉ chạm được app được cấp. Đây là RBAC thật —
 * tag `role:*` trên user không bao giờ thay thế được bảng này.
 *
 * Hai composite FK dưới đây là lớp chống rò rỉ chéo ACCOUNT ở tầng quyền: admin và app phải
 * cùng một account, nếu không INSERT bị từ chối ngay ở DB. Cùng cơ chế với fk_users_app_org
 * (ADR-0011). InnoDB cho phép FK trỏ tới index KHÔNG unique, nên các unique đích
 * (uq_admins_admin_account, uq_apps_app_account) không được xoá.
 */
export const adminAppRoles = mysqlTable(
  'admin_app_roles',
  {
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.adminId),
    appId: uuid('app_id').notNull(),
    /** Denormalize để ép được hai composite FK bên dưới. */
    accountId: uuid('account_id').notNull(),
    role: mysqlEnum('role', ADMIN_ROLES).notNull(),
    grantedAt: tsNow('granted_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    primaryKey({ columns: [t.adminId, t.appId] }),
    foreignKey({
      name: 'fk_admin_app_roles_admin_account',
      columns: [t.adminId, t.accountId],
      foreignColumns: [admins.adminId, admins.accountId],
    }),
    // Kiêm luôn FK app_id -> apps: không có app thì không có cặp (app_id, account_id) nào khớp.
    foreignKey({
      name: 'fk_admin_app_roles_app_account',
      columns: [t.appId, t.accountId],
      foreignColumns: [apps.appId, apps.accountId],
    }),
  ],
);
