import { foreignKey, index, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { ADMIN_ROLES, ORG_ROLES } from '../../../../shared/kernel/enums.ts';
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
    role: mysqlEnum('role', ADMIN_ROLES).notNull().default('user'),
    /**
     * NULL = chưa đặt mật khẩu -> không đăng nhập được. Cho phép NULL là CÓ CHỦ ĐÍCH: migration
     * thêm cột này không phải bịa mật khẩu cho dòng cũ, và nhờ vậy migration chỉ THÊM, không sửa
     * — lùi image về bản cũ không cần lùi database.
     */
    passwordHash: varchar('password_hash', { length: 255 }),
    /**
     * Object ID (`oid`) của tài khoản Microsoft 365 đã gắn — NULL = chưa đăng nhập M365 lần nào (ADR-0021).
     * Gắn ở lần đăng nhập M365 đầu tiên (khớp theo email), từ đó tra theo `oid`: email có thể đổi, `oid` thì không.
     */
    microsoftOid: varchar('microsoft_oid', { length: 36 }),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_admins_account_email').on(t.accountId, t.email),
    // Một tài khoản Microsoft gắn với tối đa một admin. NULL lặp lại được (MySQL không coi NULL là trùng).
    uniqueIndex('uq_admins_microsoft_oid').on(t.microsoftOid),
    // BẮT BUỘC: đích của composite FK (admin_id, account_id) trên admin_app_roles (ADR-0011).
    uniqueIndex('uq_admins_admin_account').on(t.adminId, t.accountId),
  ],
);

/**
 * Thành viên của org và vai của họ (ADR-0022). Một người thuộc nhiều org được, mỗi org một vai.
 *
 * Hai composite FK cùng mẫu ADR-0011: org và admin phải cùng account, nếu không INSERT bị từ chối
 * ngay ở DB. Đích là `uq_organizations_org_account` và `uq_admins_admin_account` — đừng xoá.
 * "Org luôn còn ít nhất một owner" MySQL không ép được: command khoá dòng org rồi mới đếm (ADR-0009).
 */
export const orgMembers = mysqlTable(
  'org_members',
  {
    orgId: uuid('org_id').notNull(),
    adminId: uuid('admin_id').notNull(),
    /** Denormalize để ép được hai composite FK bên dưới. */
    accountId: uuid('account_id').notNull(),
    role: mysqlEnum('role', ORG_ROLES).notNull(),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.adminId] }),
    // Mỗi request `/admin` tra mọi org của người gọi.
    index('idx_org_members_admin').on(t.adminId),
    foreignKey({
      name: 'fk_org_members_org_account',
      columns: [t.orgId, t.accountId],
      foreignColumns: [organizations.orgId, organizations.accountId],
    }),
    foreignKey({
      name: 'fk_org_members_admin_account',
      columns: [t.adminId, t.accountId],
      foreignColumns: [admins.adminId, admins.accountId],
    }),
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
