import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from '../observability/logger.ts';
import { PROBLEM_CONTENT_TYPE, problem, toProblem } from './problem.ts';

/** Một phụ thuộc mà `/health/ready` phải kiểm (MySQL, Redis...). Ném lỗi = chưa sẵn sàng. */
export interface ReadinessCheck {
  name: string;
  check(): Promise<void>;
}

/** Route của một module (`modules/<x>/interface/http/`) — lượt 4 trở đi đăng ký qua đây. */
export type HttpRoutes = (app: FastifyInstance) => Promise<void> | void;

export interface HttpServer {
  readonly app: FastifyInstance;
  /** Bật khi nhận SIGTERM: `/health/ready` trả 503 để load balancer ngừng dồn request mới. */
  startDraining(): void;
}

/** Body tối đa: payload notification ≤ 2 KB (ép ở domain) + vỏ JSON — 64 KB là dư dả. */
const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Dựng Fastify dùng chung cho process `api`. Không nghiệp vụ ở đây: chỉ health check,
 * request id, log truy cập và biến MỌI lỗi thành `application/problem+json`.
 */
export async function buildHttpServer(options: {
  logger: Logger;
  readiness: readonly ReadinessCheck[];
  routes?: readonly HttpRoutes[] | undefined;
}): Promise<HttpServer> {
  const log = options.logger.child('http');
  let draining = false;

  const app = Fastify({
    // Log truy cập đi qua port Logger bên dưới, không qua pino riêng của Fastify.
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128 ? incoming : randomUUID();
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  // Đang tắt: trả nốt response rồi đóng kết nối. Gắn ở onSend (lúc GỬI), không ở onRequest: request
  // đang dở đã qua onRequest từ trước khi tắt. Không có hook này, kết nối keep-alive của request đó
  // trở thành "rảnh" SAU lúc close() dọn kết nối rảnh -> close() treo tới hết keep-alive timeout.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (draining) reply.header('connection', 'close');
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    log.info('request completed', {
      request_id: request.id,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    });
  });

  app.setErrorHandler(async (err, request, reply) => {
    const body = toProblem(err, request.url);
    if (body.status >= 500) {
      log.error('unhandled error', {
        request_id: request.id,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    return reply.status(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
  });
  app.setNotFoundHandler(async (request, reply) =>
    reply
      .status(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(problem(404, 'NOT_FOUND', `route ${request.method} ${request.url} not found`, { instance: request.url })),
  );

  /** Process còn sống — không kiểm phụ thuộc (orchestrator restart process nếu cái này fail). */
  app.get('/health/live', async () => ({ status: 'ok' }));

  /** Nhận request được chưa — kiểm từng phụ thuộc; đang tắt thì luôn 503. */
  app.get('/health/ready', async (_request, reply) => {
    if (draining) {
      return reply.status(503).send({ status: 'draining', checks: {} });
    }
    const results = await Promise.all(
      options.readiness.map(async ({ name, check }) => {
        try {
          await check();
          return [name, 'ok'] as const;
        } catch (err) {
          log.warn('readiness check failed', { check: name, error: err instanceof Error ? err.message : String(err) });
          return [name, 'fail'] as const;
        }
      }),
    );
    const checks = Object.fromEntries(results);
    const ok = results.every(([, status]) => status === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'unavailable', checks });
  });

  for (const register of options.routes ?? []) await app.register(async (scope) => register(scope));

  return {
    app,
    startDraining: () => {
      draining = true;
    },
  };
}
