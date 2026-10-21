import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from '../observability/logger.ts';
import { adminCaller, bearerToken, type AdminAuthenticator, type AdminAuthorizer, type ApiKeyAuthenticator, type RouteTarget } from './auth.ts';
import { PROBLEM_CONTENT_TYPE, problem, toProblem } from './problem.ts';
import { redactUrl } from './redact.ts';
import { RateLimitedError } from '../kernel/errors.ts';

/** Một phụ thuộc mà `/health/ready` phải kiểm (MySQL, Redis...). Ném lỗi = chưa sẵn sàng. */
export interface ReadinessCheck {
  name: string;
  check(): Promise<void>;
}

/** Route của một module (`modules/<x>/interface/http/`). Path viết TƯƠNG ĐỐI với bề mặt của nó. */
export type HttpRoutes = (app: FastifyInstance) => Promise<void> | void;

/**
 * Ba bề mặt HTTP, mỗi bề mặt một cách xác thực (tài liệu kiến trúc §11). Module KHÔNG tự gắn hook
 * xác thực — chỉ khai route vào đúng bề mặt, server lo phần còn lại:
 *   public — không xác thực (health; sau này trang /u/:token tự xác thực bằng token ký).
 *   admin  — prefix `/admin`, console quản trị.
 *   v1     — prefix `/v1`, app service gọi bằng API key.
 */
export interface HttpSurfaces {
  public?: readonly HttpRoutes[] | undefined;
  admin?: readonly HttpRoutes[] | undefined;
  v1?: readonly HttpRoutes[] | undefined;
}

export interface HttpServer {
  readonly app: FastifyInstance;
  /** Bật khi nhận SIGTERM: `/health/ready` trả 503 để load balancer ngừng dồn request mới. */
  startDraining(): void;
}

class MalformedJsonError extends Error {
  readonly statusCode = 400;
  readonly code = 'MALFORMED_JSON';

  constructor() {
    super('request body is not valid JSON');
  }
}

/**
 * Giới hạn body MẶC ĐỊNH cho mọi route: đủ cho mọi request quản trị / đồng bộ user.
 * Route cần body lớn (gửi email kèm HTML — ADR-0016) khai riêng:
 *   app.post('/notifications', { bodyLimit: LARGE_BODY_LIMIT_BYTES }, handler)
 * Không nới giới hạn cho toàn API — mỗi route lớn là một quyết định có chủ đích.
 */
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
/** Email: html + text mỗi phần ≤ 256 KB (EmailContent) + vỏ JSON. */
export const LARGE_BODY_LIMIT_BYTES = 512 * 1024;

/**
 * Dựng Fastify dùng chung cho process `api`. Không nghiệp vụ ở đây: chỉ health check,
 * request id, log truy cập và biến MỌI lỗi thành `application/problem+json`.
 */
export async function buildHttpServer(options: {
  logger: Logger;
  readiness: readonly ReadinessCheck[];
  authenticators: { apiKey: ApiKeyAuthenticator; admin: AdminAuthenticator };
  /** Kiểm quyền mọi route `/admin/*` (ADR-0022) — chạy SAU khi parse body, trước handler. */
  adminAuthorizer: AdminAuthorizer;
  surfaces?: HttpSurfaces | undefined;
  /** Sau load balancer / reverse proxy: lấy IP thật từ X-Forwarded-For (cho allowlist IP). */
  trustProxy?: boolean | undefined;
}): Promise<HttpServer> {
  const log = options.logger.child('http');
  let draining = false;

  const app = Fastify({
    // Log truy cập đi qua port Logger bên dưới, không qua pino riêng của Fastify.
    logger: false,
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    trustProxy: options.trustProxy ?? false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128 ? incoming : randomUUID();
    },
  });

  // Body rỗng kèm `Content-Type: application/json` là chuyện thường (fetch/axios gắn header mặc định cho
  // POST không body, ví dụ `/apps/:id/submit`). Parser mặc định của Fastify trả 400 cho trường hợp đó;
  // ở đây body rỗng = "không có body", còn JSON hỏng thì vẫn 400 với mã riêng.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new MalformedJsonError(), undefined);
    }
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
      url: redactUrl(request.url),
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    });
  });

  app.setErrorHandler(async (err, request, reply) => {
    const body = toProblem(err, redactUrl(request.url));
    if (body.status >= 500) {
      log.error('unhandled error', {
        request_id: request.id,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    if (err instanceof RateLimitedError && err.retryAfterSeconds !== undefined) {
      reply.header('retry-after', String(Math.max(1, Math.ceil(err.retryAfterSeconds))));
    }
    return reply.status(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
  });
  app.setNotFoundHandler(async (request, reply) =>
    reply
      .status(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(problem(404, 'NOT_FOUND', `route ${request.method} ${redactUrl(request.url)} not found`, { instance: redactUrl(request.url) })),
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

  app.decorateRequest('caller', null);
  app.decorateRequest('adminAccess', null);
  const { apiKey, admin } = options.authenticators;
  const surfaces = options.surfaces ?? {};

  for (const register of surfaces.public ?? []) await app.register(async (scope) => register(scope));

  // Mỗi bề mặt là một scope riêng: hook xác thực chỉ áp cho route BÊN TRONG scope đó.
  // Xác thực chạy ở onRequest — trước khi body được parse, request không có credential bị chặn sớm.
  await app.register(
    async (scope) => {
      scope.addHook('onRequest', async (request) => {
        request.caller = await admin.authenticate({ bearerToken: bearerToken(request) });
      });
      // Route thiếu khai báo quyền -> DỪNG KHỞI ĐỘNG, không âm thầm mở cho mọi admin (ADR-0022).
      scope.addHook('onRoute', (route) => {
        if (route.config?.access === undefined) {
          throw new Error(`admin route ${String(route.method)} ${route.url} declares no access (use { config: access(...) })`);
        }
      });
      // preHandler (không phải onRequest): body đã parse — `POST /apps` lấy org từ body.
      scope.addHook('preHandler', async (request) => {
        const rule = request.routeOptions.config.access!;
        request.adminAccess = await options.adminAuthorizer.authorize({
          caller: adminCaller(request),
          permission: typeof rule.permission === 'function' ? rule.permission(request) : rule.permission,
          target: rule.target ? rule.target(request) : defaultTarget(request.params),
        });
      });
      for (const register of surfaces.admin ?? []) await register(scope);
    },
    { prefix: '/admin' },
  );
  await app.register(
    async (scope) => {
      scope.addHook('onRequest', async (request) => {
        request.caller = await apiKey.authenticate({ apiKey: bearerToken(request), ip: request.ip });
      });
      for (const register of surfaces.v1 ?? []) await register(scope);
    },
    { prefix: '/v1' },
  );

  return {
    app,
    startDraining: () => {
      draining = true;
    },
  };
}

/** `:appId` -> app, không có thì `:orgId` -> org, không có nữa -> việc cấp hệ thống. */
function defaultTarget(params: unknown): RouteTarget {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p['appId'] === 'string') return { kind: 'app', appId: p['appId'] };
  if (typeof p['orgId'] === 'string') return { kind: 'org', orgId: p['orgId'] };
  return { kind: 'none' };
}
