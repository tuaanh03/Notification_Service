import { index, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
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
    /**
     * NULL = chưa đặt mật khẩu -> không đăng nhập được. Cho phép NULL là CÓ CHỦ ĐÍCH: migration
     * thêm cột này không phải bịa mật khẩu cho dòng cũ, và nhờ vậy migration chỉ THÊM, không sửa
     * — lùi image về bản cũ không cần lùi database.
     */
    passwordHash: varchar('password_hash', { length: 255 }),
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
 * Phiên đăng nhập của admin — NGUỒN SỰ THẬT cho `/admin/*`. Đăng xuất xoá dòng ở đây là mất
 * quyền ngay; token tự chứa (JWT) không làm được việc đó nếu không tra bảng.
 *
 * Lưu BĂM của token, không lưu token (cùng quy ước với `app_secrets`, ADR-0015 §3).
 */
export const adminSessions = mysqlTable(
  'admin_sessions',
  {
    sessionId: uuidPk('session_id'),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.adminId),
    /** sha256 dạng hex = đúng 64 ký tự. Duy nhất: một token ứng với đúng một phiên. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_admin_sessions_token').on(t.tokenHash),
    // Đổi mật khẩu -> đá mọi phiên của admin đó.
    index('idx_admin_sessions_admin').on(t.adminId),
    // Dọn phiên hết hạn.
    index('idx_admin_sessions_expires').on(t.expiresAt),
  ],
);
