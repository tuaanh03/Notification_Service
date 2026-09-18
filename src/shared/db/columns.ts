import { sql } from 'drizzle-orm';
import { char, datetime } from 'drizzle-orm/mysql-core';

/**
 * MySQL không có kiểu UUID và không có gen_random_uuid().
 * -> lưu CHAR(36), sinh id ở tầng application (shared/kernel/ids.ts).
 *
 * MySQL cũng không có TIMESTAMPTZ. TIMESTAMP thì chết năm 2038 và tự đổi theo
 * timezone của session -> dùng DATETIME(3) và LUÔN ghi giờ UTC từ application.
 */
export const uuid = (name: string) => char(name, { length: 36 });

export const uuidPk = (name: string) => char(name, { length: 36 }).primaryKey();

export const ts = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

export const tsNow = (name: string) =>
  datetime(name, { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`);
