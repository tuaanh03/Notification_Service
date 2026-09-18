import { describe, expect, it } from 'vitest';
import { isDuplicateKeyError, mysqlErrorCode } from '../../src/shared/db/errors.ts';

describe('nhận diện lỗi MySQL', () => {
  const driverError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });

  it('đọc được mã ở lỗi của driver', () => {
    expect(mysqlErrorCode(driverError)).toBe('ER_DUP_ENTRY');
  });

  // Drizzle bọc lỗi driver trong DrizzleQueryError, lỗi gốc nằm ở `cause`.
  it('lần theo chuỗi cause khi lỗi bị bọc', () => {
    const wrapped = new Error('Failed query', { cause: driverError });
    expect(isDuplicateKeyError(new Error('outer', { cause: wrapped }))).toBe(true);
  });

  it('lỗi không phải của MySQL -> null', () => {
    expect(mysqlErrorCode(new Error('nope'))).toBeNull();
    expect(mysqlErrorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeNull();
    expect(mysqlErrorCode(undefined)).toBeNull();
  });
});
