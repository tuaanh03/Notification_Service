import { z } from 'zod';
import { LOG_LEVELS } from '../observability/logger.ts';

/**
 * Cấu hình đọc MỘT LẦN lúc khởi động, validate xong mới chạy tiếp (fail-fast).
 * Không module nào đọc `process.env` trực tiếp — nhận `Env` đã validate qua dependency.
 *
 * Chỉ khai biến mà code hiện tại thật sự dùng — thêm biến đúng lúc bước dùng nó xuất hiện,
 * để không bắt môi trường dev phải khai biến chưa ai đọc.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Process `api`: địa chỉ lắng nghe. 0.0.0.0 để nhận kết nối từ ngoài container. */
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z
    .string()
    .regex(/^mysql:\/\/.+/, 'must be a mysql:// connection URL'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(10),
  /** Redis Streams: hàng đợi công việc + event bus. KHÔNG phải nguồn sự thật — mất Redis thì relay lại từ outbox. */
  REDIS_URL: z.string().regex(/^rediss?:\/\/.+/, 'must be a redis:// or rediss:// URL'),
  /**
   * Process `worker`: chạy consumer group nào. `all` = mọi group đã đăng ký; hoặc danh sách cách
   * nhau bởi dấu phẩy, ví dụ `delivery-email` — để scale riêng phần gửi mail (tài liệu §12).
   */
  WORKER_GROUPS: z
    .string()
    .default('all')
    .transform((raw): 'all' | readonly string[] => {
      const groups = raw.split(',').map((g) => g.trim()).filter(Boolean);
      return groups.length === 0 || groups.includes('all') ? 'all' : groups;
    }),
});

export type Env = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Nhận `source` làm tham số để test không phải sửa `process.env` toàn cục. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return Object.freeze(result.data);
}
