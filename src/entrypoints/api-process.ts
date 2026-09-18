import type { Container } from '../composition/index.ts';
import { pingDatabase } from '../shared/db/index.ts';
import { buildHttpServer, type HttpRoutes } from '../shared/http/index.ts';
import { pingRedis } from '../shared/streams/index.ts';
import type { RunningProcess } from './lifecycle.ts';

export interface RunningApi extends RunningProcess {
  /** Địa chỉ thật đang lắng nghe — cần khi PORT=0 (test). */
  readonly url: string;
}

/**
 * Process `api`: nhận HTTP, gọi command, ghi DB + outbox, trả response. KHÔNG tự gửi mail,
 * KHÔNG XADD thẳng — việc nặng đi qua outbox sang worker.
 */
export async function startApi(
  container: Container,
  options: { routes?: readonly HttpRoutes[] | undefined } = {},
): Promise<RunningApi> {
  const { database, redis } = container.infra;
  const server = await buildHttpServer({
    logger: container.ports.logger,
    readiness: [
      { name: 'mysql', check: () => pingDatabase(database.db) },
      { name: 'redis', check: () => pingRedis(redis) },
    ],
    // Route nghiệp vụ của các module đăng ký ở đây từ lượt 4.
    routes: options.routes,
  });
  const url = await server.app.listen({ host: container.env.HOST, port: container.env.PORT });

  return {
    url,
    stop: async () => {
      // Báo "không sẵn sàng" trước để load balancer ngừng dồn request, rồi mới đóng:
      // close() chờ request đang xử lý xong, không cắt ngang transaction.
      server.startDraining();
      await server.app.close();
    },
  };
}
