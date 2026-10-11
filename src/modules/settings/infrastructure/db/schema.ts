import { json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { tsNow } from '../../../../shared/db/columns.ts';

/** Cài đặt hệ thống (ADR-0030). Chỉ dòng ĐÃ chỉnh — khoá không có dòng là đang dùng mặc định trong code. */
export const systemSettings = mysqlTable('system_settings', {
  settingKey: varchar('setting_key', { length: 64 }).primaryKey(),
  value: json('value').$type<unknown>(),
  updatedBy: varchar('updated_by', { length: 64 }),
  updatedAt: tsNow('updated_at'),
});
