import type { Container } from '../composition/index.ts';

/** Một process đang chạy. `stop()` dừng nhận việc mới và CHỜ việc đang dở xong. */
export interface RunningProcess {
  stop(): Promise<void>;
}

/** Quá hạn này mà chưa tắt xong thì thoát cưỡng bức — nhỏ hơn `stop_grace_period` của compose (15 s). */
const SHUTDOWN_TIMEOUT_MS = 12_000;

/**
 * Vòng đời chung của mọi process chạy lâu dài (api / worker / scheduler):
 *
 *   start() ─► chạy ─► SIGTERM|SIGINT ─► stop() (việc dở chạy nốt) ─► container.dispose() ─► exit 0
 *
 * - start lỗi (không kết nối được DB, cấu hình sai...) -> log fatal, exit 1: orchestrator restart.
 * - Tắt quá SHUTDOWN_TIMEOUT_MS -> exit 1: không treo mãi chờ một kết nối chết.
 * - Lỗi không ai bắt (unhandledRejection / uncaughtException) -> tắt có trật tự với exit 1, thay vì
 *   chạy tiếp ở trạng thái không xác định.
 */
export async function runProcess(options: {
  name: string;
  container: Container;
  start(): Promise<RunningProcess>;
}): Promise<void> {
  const { name, container } = options;
  const log = container.ports.logger.child(name);

  let running: RunningProcess;
  try {
    running = await options.start();
  } catch (err) {
    log.fatal('failed to start', { error: errorMessage(err) });
    await container.dispose().catch(() => undefined);
    process.exit(1);
  }
  log.info('started', { pid: process.pid });

  // Giữ process sống tới khi có tín hiệu tắt. Không có dòng này, process không còn timer/socket nào
  // (ví dụ worker chưa có consumer) sẽ tự thoát mã 0 ngay sau khi khởi động -> restart vô hạn.
  const keepAlive = setInterval(() => undefined, 60_000);

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepAlive);
    log.info('shutting down', { reason });
    const force = setTimeout(() => {
      log.fatal('shutdown timed out, forcing exit', { timeout_ms: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      await running.stop();
      await container.dispose();
      log.info('stopped');
      process.exitCode = exitCode;
    } catch (err) {
      log.fatal('shutdown failed', { error: errorMessage(err) });
      process.exitCode = 1;
    } finally {
      clearTimeout(force);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.once('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('unhandledRejection', (err) => {
    log.fatal('unhandled rejection', { error: errorMessage(err) });
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    log.fatal('uncaught exception', { error: errorMessage(err), stack: err.stack });
    void shutdown('uncaughtException', 1);
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
