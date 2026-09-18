import type { EventOutbox, IntegrationEvent, UnitOfWork } from '../shared/application/index.ts';
import type { Env } from '../shared/config/index.ts';
import {
  createDatabase,
  DrizzleEventOutbox,
  DrizzleUnitOfWork,
  ProcessedMessageStore,
  TransactionContext,
  type DatabaseHandle,
  type StreamRouter,
} from '../shared/db/index.ts';
import { systemClock, type Clock } from '../shared/kernel/index.ts';
import type { Logger } from '../shared/observability/logger.ts';
import { createPinoLogger } from '../shared/observability/pino-logger.ts';

/**
 * COMPOSITION ROOT — nơi DUY NHẤT biết lớp hiện thực nào đứng sau port nào.
 *
 * Wiring viết tay, không dùng thư viện DI: phụ thuộc hiện rõ trong code, compiler kiểm được,
 * không có decorator hay reflection. Mỗi entrypoint (api / worker / scheduler — lượt 3) gọi
 * `createContainer` một lần lúc khởi động và `dispose` lúc shutdown.
 *
 * Phần `ports` là thứ application được phép thấy. Phần `infra` chỉ dành cho adapter,
 * khung consumer và entrypoint — command/query không bao giờ nhận `infra`.
 */
export interface Container {
  readonly env: Env;
  readonly ports: {
    readonly logger: Logger;
    readonly clock: Clock;
    readonly uow: UnitOfWork;
    readonly outbox: EventOutbox;
  };
  readonly infra: {
    readonly database: DatabaseHandle;
    readonly transactions: TransactionContext;
    readonly processedMessages: ProcessedMessageStore;
  };
  dispose(): Promise<void>;
}

/** Thay bằng bảng định tuyến theo `eventType` ở lượt 2 (`shared/streams/names.ts`). */
const routeEverythingToAudit: StreamRouter = (_event: IntegrationEvent) => 'audit.events';

export interface ContainerOverrides {
  /** Test truyền DB đã migrate sẵn; production để container tự tạo pool từ env. */
  database?: DatabaseHandle | undefined;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
  route?: StreamRouter | undefined;
}

export function createContainer(env: Env, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? createPinoLogger({ level: env.LOG_LEVEL });
  const database =
    overrides.database ?? createDatabase({ url: env.DATABASE_URL, poolSize: env.DB_POOL_SIZE });
  const transactions = new TransactionContext(database.db);

  return {
    env,
    ports: {
      logger,
      clock: overrides.clock ?? systemClock,
      uow: new DrizzleUnitOfWork({ transactions }),
      outbox: new DrizzleEventOutbox({ transactions, route: overrides.route ?? routeEverythingToAudit }),
    },
    infra: {
      database,
      transactions,
      processedMessages: new ProcessedMessageStore({ transactions }),
    },
    dispose: () => database.close(),
  };
}
