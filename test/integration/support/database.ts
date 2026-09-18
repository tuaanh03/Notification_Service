import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createConnection } from 'mysql2/promise';
import { inject } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../../../src/shared/db/index.ts';

export interface TestDatabase extends DatabaseHandle {
  name: string;
  /** Để spawn process thật (api/worker/scheduler) trỏ vào đúng database này. */
  url: string;
}

/**
 * Database MỚI cho một file test, đã chạy toàn bộ migration trong `drizzle/`.
 * Tách database theo file để các file chạy song song không giẫm dữ liệu của nhau,
 * và để migration thật sự được chạy trên DB rỗng — chứ không phải giả định nó chạy được.
 */
export async function createTestDatabase(options: { poolSize?: number } = {}): Promise<TestDatabase> {
  const rootUrl = inject('mysqlRootUrl');
  const name = `test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

  const admin = await createConnection(rootUrl);
  try {
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await admin.end();
  }

  const url = new URL(rootUrl);
  url.pathname = `/${name}`;
  const handle = createDatabase({ url: url.toString(), poolSize: options.poolSize ?? 10 });
  await migrate(handle.db, { migrationsFolder: 'drizzle' });
  return { ...handle, name, url: url.toString() };
}

export async function tableNames(db: TestDatabase['db']): Promise<string[]> {
  const [rows] = (await db.execute(
    sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
  )) as unknown as [Array<{ name: string }>];
  return rows.map((row) => row.name);
}
