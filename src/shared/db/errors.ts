/**
 * Nhận diện lỗi MySQL theo mã. Drizzle bọc lỗi của driver trong `DrizzleQueryError`
 * (lỗi gốc nằm ở `cause`), nên phải lần theo chuỗi `cause` chứ không đọc `err.code` ngay tầng ngoài.
 */
export const MYSQL_ERRORS = {
  DUPLICATE_ENTRY: 'ER_DUP_ENTRY',
  /** Ghi dòng con trỏ tới dòng cha không tồn tại — composite FK chống rò rỉ bắn ra lỗi này. */
  NO_REFERENCED_ROW: 'ER_NO_REFERENCED_ROW_2',
  ROW_IS_REFERENCED: 'ER_ROW_IS_REFERENCED_2',
  LOCK_DEADLOCK: 'ER_LOCK_DEADLOCK',
  LOCK_WAIT_TIMEOUT: 'ER_LOCK_WAIT_TIMEOUT',
} as const;
export type MysqlErrorCode = (typeof MYSQL_ERRORS)[keyof typeof MYSQL_ERRORS];

export function mysqlErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') {
      if (current.code.startsWith('ER_')) return current.code;
    }
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return null;
}

export function isMysqlError(err: unknown, code: MysqlErrorCode): boolean {
  return mysqlErrorCode(err) === code;
}

export function isDuplicateKeyError(err: unknown): boolean {
  return isMysqlError(err, MYSQL_ERRORS.DUPLICATE_ENTRY);
}
