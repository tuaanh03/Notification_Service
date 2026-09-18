import { eq } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import type { Transaction } from './client.ts';

/**
 * Khoá DÒNG CHA trước khi đếm/ghi tập dòng con — mẫu ép ràng buộc "tối đa N dòng mỗi cha"
 * mà MySQL không ép được bằng index (ADR-0009).
 *
 * Vì sao không khoá chính tập đang đếm: khi tập đó có 0–1 dòng, `SELECT ... FOR UPDATE` ở
 * REPEATABLE READ chỉ lấy gap lock; gap lock không loại trừ nhau nên hai transaction cùng đếm
 * ra 1 rồi cùng INSERT (hoặc deadlock). Record lock trên PK của dòng cha thì loại trừ thật.
 *
 * Trả `false` nếu dòng cha không tồn tại — caller quyết định đó là 404 hay lỗi khác.
 */
export async function lockParentRow(
  tx: Transaction,
  table: MySqlTable,
  primaryKey: MySqlColumn,
  id: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: primaryKey })
    .from(table)
    .where(eq(primaryKey, id))
    .for('update');
  return rows.length > 0;
}
