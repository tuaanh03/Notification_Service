import { httpSurfaces, type Application, type Container } from '../composition/index.ts';
import { pingDatabase } from '../shared/db/index.ts';
import { BootstrapAdminAuthenticator, buildHttpServer, type HttpSurfaces } from '../shared/http/index.ts';
import { pingRedis } from '../shared/streams/index.ts';
import type { RunningProcess } from './lifecycle.ts';

export interface RunningApi extends RunningProcess {
  /** Địa chỉ thật đang lắng nghe — cần khi PORT=0 (test). */
  readonly url: string;
}

/**
 * Process `api`: nhận HTTP, gọi command, ghi DB + outbox, trả response. KHÔNG tự gửi mail,
 * KHÔNG XADD thẳng — việc nặng đi qua outbox sang worker.
 *
 * Route lấy từ `ModuleDefinition.http` của mọi module (`httpSurfaces`), xác thực lấy từ
 * `application.authenticators`. Process này không biết module nào tồn tại.
 */
export async function startApi(
  container: Container,
  application: Application,
  options: { extraSurfaces?: HttpSurfaces | undefined } = {},
): Promise<RunningApi> {
  const { database, redis } = container.infra;
  const log = container.ports.logger.child('api');
  const surfaces = httpSurfaces(application);
  const extra = options.extraSurfaces ?? {};

  if (application.authenticators.admin instanceof BootstrapAdminAuthenticator && !application.authenticators.admin.enabled) {
    log.warn('ADMIN_TOKEN is not set — every /admin/* request will be rejected');
  }

  const server = await buildHttpServer({
    logger: container.ports.logger,
    trustProxy: container.env.TRUST_PROXY,
    readiness: [
      { name: 'mysql', check: () => pingDatabase(database.db) },
      { name: 'redis', check: () => pingRedis(redis) },
    ],
    authenticators: application.authenticators,
    surfaces: {
      public: [...surfaces.public, ...(extra.public ?? [])],
      admin: [...surfaces.admin, ...(extra.admin ?? [])],
      v1: [...surfaces.v1, ...(extra.v1 ?? [])],
    },
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
