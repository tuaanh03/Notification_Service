import type { ZodType } from 'zod';
import { issue, ValidationError } from '../kernel/index.ts';

/**
 * Validate input ở BIÊN (body / params / query) bằng zod, rồi mới gọi command. Sai -> ValidationError
 * (422, cùng hình dạng `issues` với lỗi domain) — frontend xử lý một kiểu lỗi duy nhất.
 */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(
    result.error.issues.map((i) => {
      const path = i.path.map(String).join('.');
      return issue('INVALID_FIELD', i.message, path === '' ? undefined : path);
    }),
  );
}
