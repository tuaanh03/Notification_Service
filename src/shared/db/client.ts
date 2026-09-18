import { sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';

/** Drizzle không kèm relational schema: repository viết query tường minh, không dùng `db.query.*`. */
export type Database = MySql2Database;

/** Transaction đang mở — kiểu suy ra từ chính `db.transaction` để không lệch với Drizzle. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Nơi chạy được query: cả `db` lẫn `tx`. Hàm chỉ đọc/ghi mà không tự mở transaction nhận kiểu này. */
export type Executor = Database | Transaction;

export interface DatabaseOptions {
  url: string;
  poolSize: number;
}

export interface DatabaseHandle {
  db: Database;
  /** Lộ ra để entrypoint đóng khi shutdown và để health check; repository không dùng trực tiếp. */
  pool: Pool;
  close(): Promise<void>;
}

/**
 * UTC ở MỌI tầng (ADR-0002):
 *  - Drizzle tự ghi/đọc cột DATETIME dạng chuỗi UTC (`toISOString`, cộng 'Z' khi đọc).
 *  - `timezone: 'Z'` cho query thô đi qua mysql2 không qua mapper của Drizzle.
 *  - `SET time_zone = '+00:00'` cho giá trị MySQL tự sinh: `DEFAULT CURRENT_TIMESTAMP(3)` tính theo
 *    timezone của SESSION. Thiếu dòng này, created_at lệch theo cấu hình của server MySQL.
 *    mysql2 xếp hàng lệnh trên từng connection nên SET luôn chạy trước query đầu tiên.
 * Cùng hook đó đặt mức cô lập READ COMMITTED cho mọi transaction (ADR-0017).
 */
export function createDatabase(options: DatabaseOptions): DatabaseHandle {
  const pool = createPool({
    uri: options.url,
    connectionLimit: options.poolSize,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
    // READ COMMITTED, không phải REPEATABLE READ mặc định của MySQL (ADR-0017): ở RR, lệnh SELECT
    // thường đầu tiên chốt snapshot — command "đọc -> khoá dòng cha -> đọc lại" vẫn thấy dữ liệu CŨ
    // sau khi chờ khoá, và phá mẫu khoá của ADR-0009.
    connection.query("SET SESSION transaction_isolation = 'READ-COMMITTED'");
  });

  const db = drizzle({ client: pool });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

/** Health check: ném lỗi nếu DB không trả lời. */
export async function pingDatabase(db: Executor): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
