import { ConfigError, loadEnv, type Env } from '../../shared/config/index.ts';

/**
 * Fail-fast dùng chung cho mọi entrypoint: cấu hình sai thì in lỗi và thoát mã 1, trước khi mở
 * bất kỳ kết nối nào. Chưa có logger ở thời điểm này (level log nằm trong chính env) nên in thẳng stderr.
 */
export function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
