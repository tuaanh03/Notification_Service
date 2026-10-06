import { describe, expect, it } from 'vitest';
import { access, buildHttpServer, type AdminAuthorizer, type HttpRoutes, type RouteTarget } from '../../src/shared/http/index.ts';
import { PermissionDeniedError, type Permission } from '../../src/shared/kernel/index.ts';
import type { Logger } from '../../src/shared/observability/logger.ts';

/**
 * Lớp kiểm quyền gắn vào bề mặt `/admin` (ADR-0022): route nào QUÊN khai quyền thì server không
 * khởi động — chứ không âm thầm mở cho mọi admin đã đăng nhập.
 */
const silent: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child: () => silent,
};

/** Ghi lại mọi lần hỏi quyền; `deny` = danh sách quyền bị từ chối. */
function recordingAuthorizer(deny: Permission[] = []) {
  const calls: { permission: Permission; target: RouteTarget }[] = [];
  const authorizer: AdminAuthorizer = {
    async authorize({ permission, target }) {
      calls.push({ permission, target });
      if (deny.includes(permission)) throw new PermissionDeniedError('FORBIDDEN', 'no');
      return { isSuperAdmin: false, orgRoles: new Map(), appRoles: new Map() };
    },
  };
  return { calls, authorizer };
}

function server(admin: HttpRoutes, authorizer: AdminAuthorizer) {
  return buildHttpServer({
    logger: silent,
    readiness: [],
    authenticators: {
      apiKey: { authenticate: () => Promise.reject(new Error('unused')) },
      admin: { authenticate: async () => ({ kind: 'admin', adminId: 'a', role: 'user' }) },
    },
    adminAuthorizer: authorizer,
    surfaces: { admin: [admin] },
  });
}

// Lần dựng Fastify đầu tiên trong file mất ~3 giây (nạp module) — nới hạn để không đỏ khi máy đang bận.
describe('route /admin phải khai quyền', { timeout: 20_000 }, () => {
  it('thiếu `config.access` -> buildHttpServer ném lỗi, nêu đúng route', async () => {
    const forgot: HttpRoutes = (app) => {
      app.get('/apps/:appId/secret-stuff', async () => ({}));
    };
    await expect(server(forgot, recordingAuthorizer().authorizer)).rejects.toThrow(/GET \/admin\/apps\/:appId\/secret-stuff declares no access/);
  });

  it('có khai -> hỏi đúng quyền, đối tượng lấy từ :appId; bị từ chối thì handler không chạy', async () => {
    let ran = 0;
    const { calls, authorizer } = recordingAuthorizer(['app.manage']);
    const routes: HttpRoutes = (app) => {
      app.get('/apps/:appId/things', { config: access('app.read') }, async () => ({ ran: ++ran }));
      app.post('/apps/:appId/things', { config: access('app.manage') }, async () => ({ ran: ++ran }));
    };
    const { app } = await server(routes, authorizer);

    expect((await app.inject({ method: 'GET', url: '/admin/apps/x1/things' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/admin/apps/x1/things' })).statusCode).toBe(403);
    expect(ran).toBe(1);
    expect(calls).toEqual([
      { permission: 'app.read', target: { kind: 'app', appId: 'x1' } },
      { permission: 'app.manage', target: { kind: 'app', appId: 'x1' } },
    ]);
    await app.close();
  });

  it('bề mặt public / v1 không bị đòi khai quyền', async () => {
    const { app } = await buildHttpServer({
      logger: silent,
      readiness: [],
      authenticators: {
        apiKey: { authenticate: () => Promise.reject(new Error('unused')) },
        admin: { authenticate: () => Promise.reject(new Error('unused')) },
      },
      adminAuthorizer: recordingAuthorizer().authorizer,
      surfaces: { public: [(a) => void a.get('/open', async () => ({ ok: true }))] },
    });
    expect((await app.inject({ method: 'GET', url: '/open' })).statusCode).toBe(200);
    await app.close();
  });
});
