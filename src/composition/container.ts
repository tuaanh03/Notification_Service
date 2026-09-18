import type { EventOutbox, UnitOfWork } from '../shared/application/index.ts';
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
import {
  createRedis,
  OutboxRelay,
  routeEvent,
  StreamClient,
  StreamConsumer,
  type ConsumerSpec,
  type OutboxRelayOptions,
  type RedisHandle,
} from '../shared/streams/index.ts';

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
    readonly redis: RedisHandle;
    /** Trên kết nối Redis dùng chung — cho lệnh không block. */
    readonly streams: StreamClient;
    readonly outboxRelay: OutboxRelay;
    /** Mỗi consumer một kết nối Redis riêng (XREADGROUP BLOCK giữ kết nối). */
    createConsumer(spec: ConsumerSpec): StreamConsumer;
  };
  dispose(): Promise<void>;
}

export interface ContainerOverrides {
  /** Test truyền DB / Redis đã dựng sẵn; production để container tự tạo từ env. */
  database?: DatabaseHandle | undefined;
  redis?: RedisHandle | undefined;
  logger?: Logger | undefined;
  clock?: Clock | undefined;
  route?: StreamRouter | undefined;
  outboxRelay?: OutboxRelayOptions | undefined;
}

export function createContainer(env: Env, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? createPinoLogger({ level: env.LOG_LEVEL });
  const clock = overrides.clock ?? systemClock;
  const database =
    overrides.database ?? createDatabase({ url: env.DATABASE_URL, poolSize: env.DB_POOL_SIZE });
  const redis = overrides.redis ?? createRedis({ url: env.REDIS_URL });

  const transactions = new TransactionContext(database.db);
  const uow = new DrizzleUnitOfWork({ transactions });
  const processedMessages = new ProcessedMessageStore({ transactions });
  const streams = new StreamClient(redis.client);

  return {
    env,
    ports: {
      logger,
      clock,
      uow,
      outbox: new DrizzleEventOutbox({ transactions, route: overrides.route ?? routeEvent }),
    },
    infra: {
      database,
      transactions,
      processedMessages,
      redis,
      streams,
      outboxRelay: new OutboxRelay({
        uow,
        transactions,
        streams,
        clock,
        logger: logger.child('outbox-relay'),
        options: overrides.outboxRelay,
      }),
      createConsumer: (spec) =>
        new StreamConsumer({
          streams: new StreamClient(redis.createBlockingConnection(spec.consumer)),
          uow,
          processedMessages,
          logger,
          spec,
        }),
    },
    dispose: async () => {
      // Đóng Redis trước: consumer đang BLOCK bị cắt, không còn ai giữ transaction DB mới.
      await redis.close();
      await database.close();
    },
  };
}
