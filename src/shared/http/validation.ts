import { z, type ZodType } from 'zod';
import { issue, ValidationError } from '../kernel/index.ts';

/**
 * `external_id` do app service tự đặt — dùng chung cho mọi route `/v1/users/:externalId/...` của mọi
 * module. Cho phép ký tự thường gặp của id (chữ, số, . _ - : @ |), cấm khoảng trắng và ký tự điều
 * khiển. Tối đa 255 = độ dài cột `users.external_id`.
 */
export const EXTERNAL_ID = z.string().min(1).max(255).regex(/^[A-Za-z0-9._\-:@|]+$/, 'invalid external id');

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
