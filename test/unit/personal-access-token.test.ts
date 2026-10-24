import { describe, expect, it } from 'vitest';
import type { EventOutbox, IntegrationEvent, UnitOfWork } from '../../src/shared/application/index.ts';
import { access, adminContext, buildHttpServer, requireSession, type AdminCaller, type HttpRoutes } from '../../src/shared/http/index.ts';
import {
  AccountId,
  AdminId,
  AuthenticationError,
  NotFoundError,
  PersonalAccessTokenId,
  ValidationError,
  fixedClock,
  type AdminId as AdminIdType,
  type PersonalAccessTokenId as PersonalAccessTokenIdType,
} from '../../src/shared/kernel/index.ts';
import type { Logger } from '../../src/shared/observability/logger.ts';
import { Admin } from '../../src/modules/tenancy/domain/entities/admin.ts';
import { PersonalAccessToken } from '../../src/modules/tenancy/domain/entities/personal-access-token.ts';
import { CreatePersonalAccessToken, RevokePersonalAccessToken } from '../../src/modules/tenancy/application/commands/manage-personal-access-tokens.ts';
import { AuthenticatePersonalAccessToken, ListPersonalAccessTokens } from '../../src/modules/tenancy/application/queries/personal-access-tokens.ts';
import type { AdminRepository, PersonalAccessTokenRepository } from '../../src/modules/tenancy/application/ports/index.ts';
import { RandomPersonalAccessTokenFactory } from '../../src/modules/tenancy/infrastructure/adapters/random-personal-access-token-factory.ts';

/** Personal access token (ADR-0044): hạn, trần, thu hồi, xác thực, chỉ đọc, chỉ phiên. */
const NOW = new Date('2026-10-23T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const CTX = { actor: { id: 'test', type: 'admin' as const }, source: 'admin_api' as const };
const uow: UnitOfWork = { run: async (work) => work() };

class FakeOutbox implements EventOutbox {
  readonly events: IntegrationEvent[] = [];
  async append(events: readonly IntegrationEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

/** Chỉ những gì PAT dùng tới. */
function fakeAdmins(list: Admin[]): AdminRepository {
  const partial: Partial<AdminRepository> = {
    findById: async (id) => list.find((a) => a.id === id) ?? null,
    lockForUpdate: async (id) => list.some((a) => a.id === id),
    findManyByIds: async (ids) => list.filter((a) => ids.includes(a.id)),
  };
  return partial as AdminRepository;
}

class FakeTokens implements PersonalAccessTokenRepository {
  readonly rows: PersonalAccessToken[] = [];
  lastUsedWrites = 0;
  async insert(token: PersonalAccessToken) {
    this.rows.push(token);
  }
  async findByTokenHash(hash: string) {
    return this.rows.find((t) => t.tokenHash === hash) ?? null;
  }
  async findById(id: PersonalAccessTokenIdType) {
    return this.rows.find((t) => t.id === id) ?? null;
  }
  async listByAdmin(adminId: AdminIdType, since: Date) {
    return this.rows.filter((t) => t.adminId === adminId && (t.isUsableAt(since) || (t.revokedAt ?? new Date(0)) > since));
  }
  async listAll() {
    return [...this.rows];
  }
  async countActive(adminId: AdminIdType, at: Date) {
    return this.rows.filter((t) => t.adminId === adminId && t.isUsableAt(at)).length;
  }
  async updateRevoked() {}
  async updateLastUsed() {
    this.lastUsedWrites += 1;
  }
}

function admin(props: { locked?: boolean } = {}): Admin {
  return new Admin({
    id: AdminId.create(),
    accountId: AccountId.create(),
    email: 'dev@test.local',
    role: 'user',
    passwordHash: null,
    lockedAt: props.locked ? NOW : null,
    createdAt: NOW,
  });
}

function setup(limits = { maxPerAdmin: 2, maxLifetimeDays: 365 }, at: Date = NOW) {
  const owner = admin();
  const admins = fakeAdmins([owner]);
  const tokens = new FakeTokens();
  const outbox = new FakeOutbox();
  const factory = new RandomPersonalAccessTokenFactory();
  const clock = fixedClock(at);
  const create = new CreatePersonalAccessToken({ uow, outbox, clock, admins, tokens, factory, policy: { current: async () => limits } });
  const authenticate = new AuthenticatePersonalAccessToken({ clock, admins, tokens, factory });
  const revoke = new RevokePersonalAccessToken({ uow, outbox, clock, tokens });
  return { owner, admins, tokens, outbox, factory, create, authenticate, revoke };
}

describe('PersonalAccessToken — trạng thái', () => {
  const token = (props: { revokedAt?: Date }) =>
    new PersonalAccessToken({
      id: PersonalAccessTokenId.create(),
      adminId: AdminId.create(),
      name: 'ci',
      tokenHash: 'h',
      hint: 'ewspat_…abcd',
      scope: 'write',
      expiresAt: new Date(NOW.getTime() + DAY),
      revokedAt: props.revokedAt ?? null,
      createdAt: NOW,
    });

  it('còn hạn = active; tới đúng mốc hết hạn = expired', () => {
    const t = token({});
    expect(t.statusAt(NOW)).toBe('active');
    expect(t.statusAt(new Date(NOW.getTime() + DAY))).toBe('expired');
  });

  it('thu hồi thắng hết hạn, và thu hồi lần hai không làm gì', () => {
    const t = token({});
    expect(t.revoke(NOW)).toBe(true);
    expect(t.revoke(NOW)).toBe(false);
    expect(t.statusAt(new Date(NOW.getTime() + 2 * DAY))).toBe('revoked');
  });

  it('"dùng lần cuối" chỉ đáng ghi mỗi phút một lần, hoặc khi đổi IP', () => {
    const t = token({});
    expect(t.recordUse(NOW, '10.0.0.1')).toBe(true);
    expect(t.recordUse(new Date(NOW.getTime() + 30_000), '10.0.0.1')).toBe(false);
    expect(t.recordUse(new Date(NOW.getTime() + 31_000), '10.0.0.2')).toBe(true);
    expect(t.recordUse(new Date(NOW.getTime() + 92_000), '10.0.0.2')).toBe(true);
  });
});

describe('Tạo PAT', () => {
  it('token gốc có tiền tố ewspat_, chỉ trả một lần; DB và audit chỉ có băm + gợi nhớ', async () => {
    const { owner, tokens, outbox, create } = setup();
    const issued = await create.execute({ adminId: owner.id, name: 'CI deploy', scope: 'write', expiresInDays: 90 }, CTX);

    expect(issued.secret).toMatch(/^ewspat_[A-Za-z0-9_-]{43}$/);
    expect(issued.token.hint).toBe(`ewspat_…${issued.secret.slice(-4)}`);
    expect(issued.token.status).toBe('active');
    expect(issued.token.expiresAt).toBe(new Date(NOW.getTime() + 90 * DAY).toISOString());
    expect(tokens.rows[0]?.tokenHash).not.toContain(issued.secret);
    expect(outbox.events.map((e) => e.eventType)).toEqual(['PersonalAccessTokenCreated']);
    expect(JSON.stringify(outbox.events)).not.toContain(issued.secret);
  });

  it('hạn dài hơn cài đặt -> PAT_LIFETIME_TOO_LONG, không tạo gì', async () => {
    const { owner, tokens, create } = setup({ maxPerAdmin: 5, maxLifetimeDays: 30 });
    const err = await create.execute({ adminId: owner.id, name: 'x', scope: 'read', expiresInDays: 31 }, CTX).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).issues.map((i) => [i.code, i.path])).toEqual([['PAT_LIFETIME_TOO_LONG', 'expiresInDays']]);
    expect(tokens.rows).toHaveLength(0);
  });

  it('đủ trần token còn hiệu lực -> PAT_LIMIT_REACHED; thu hồi một cái thì tạo tiếp được', async () => {
    const { owner, create, revoke } = setup({ maxPerAdmin: 2, maxLifetimeDays: 365 });
    const first = await create.execute({ adminId: owner.id, name: 'a', scope: 'read', expiresInDays: 1 }, CTX);
    await create.execute({ adminId: owner.id, name: 'b', scope: 'read', expiresInDays: 1 }, CTX);
    const err = await create.execute({ adminId: owner.id, name: 'c', scope: 'read', expiresInDays: 1 }, CTX).catch((e: unknown) => e);
    expect((err as ValidationError).issues[0]?.code).toBe('PAT_LIMIT_REACHED');

    await revoke.execute({ tokenId: PersonalAccessTokenId.parse(first.token.tokenId), ownerId: owner.id }, CTX);
    await expect(create.execute({ adminId: owner.id, name: 'c', scope: 'read', expiresInDays: 1 }, CTX)).resolves.toBeDefined();
  });
});

describe('Xác thực bằng PAT', () => {
  it('token hợp lệ -> admin của chính người tạo, kèm scope', async () => {
    const { owner, create, authenticate } = setup();
    const { secret, token } = await create.execute({ adminId: owner.id, name: 'ci', scope: 'read', expiresInDays: 7 }, CTX);
    expect(authenticate.matches(secret)).toBe(true);
    expect(authenticate.matches('random-session-token')).toBe(false);
    const who = await authenticate.execute({ token: secret, ip: '1.2.3.4' });
    expect(who).toMatchObject({ adminId: owner.id, scope: 'read', tokenId: token.tokenId });
  });

  it('token lạ / đã thu hồi / hết hạn / admin bị khoá -> cùng 401 INVALID_ADMIN_SESSION', async () => {
    const { owner, tokens, create, revoke, authenticate, factory } = setup();
    const revoked = await create.execute({ adminId: owner.id, name: 'r', scope: 'write', expiresInDays: 1 }, CTX);
    await revoke.execute({ tokenId: PersonalAccessTokenId.parse(revoked.token.tokenId), ownerId: owner.id }, CTX);
    const expired = await create.execute({ adminId: owner.id, name: 'e', scope: 'write', expiresInDays: 1 }, CTX);

    const later = new AuthenticatePersonalAccessToken({ clock: fixedClock(new Date(NOW.getTime() + DAY)), admins: fakeAdmins([owner]), tokens, factory });
    const lockedOwner = admin({ locked: true });
    const lockedSetup = setup();
    const ofLocked = new AuthenticatePersonalAccessToken({ clock: fixedClock(NOW), admins: fakeAdmins([lockedOwner]), tokens: lockedSetup.tokens, factory });
    const lockedSecret = (await lockedSetup.create.execute({ adminId: lockedSetup.owner.id, name: 'l', scope: 'write', expiresInDays: 9 }, CTX)).secret;

    for (const attempt of [
      authenticate.execute({ token: 'ewspat_khong-ton-tai', ip: null }),
      authenticate.execute({ token: revoked.secret, ip: null }),
      later.execute({ token: expired.secret, ip: null }),
      ofLocked.execute({ token: lockedSecret, ip: null }),
    ]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthenticationError);
      expect((err as AuthenticationError).code).toBe('INVALID_ADMIN_SESSION');
    }
  });

  it('gọi liên tục trong một phút chỉ ghi "dùng lần cuối" một lần', async () => {
    const { owner, tokens, create, authenticate } = setup();
    const { secret } = await create.execute({ adminId: owner.id, name: 'ci', scope: 'read', expiresInDays: 7 }, CTX);
    for (let i = 0; i < 5; i += 1) await authenticate.execute({ token: secret, ip: '1.2.3.4' });
    expect(tokens.lastUsedWrites).toBe(1);
  });
});

describe('Thu hồi PAT', () => {
  it('token của người khác -> 404 NOT_FOUND (không xác nhận nó tồn tại); Super Admin (ownerId null) thu hồi được', async () => {
    const { owner, create, revoke, outbox } = setup();
    const { token } = await create.execute({ adminId: owner.id, name: 'ci', scope: 'read', expiresInDays: 7 }, CTX);
    const id = PersonalAccessTokenId.parse(token.tokenId);

    const err = await revoke.execute({ tokenId: id, ownerId: AdminId.create() }, CTX).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('NOT_FOUND');

    await revoke.execute({ tokenId: id, ownerId: null }, CTX);
    await revoke.execute({ tokenId: id, ownerId: null }, CTX);
    expect(outbox.events.filter((e) => e.eventType === 'PersonalAccessTokenRevoked')).toHaveLength(1);
  });

  it('danh sách của mình hiện cả token đã thu hồi gần đây', async () => {
    const { owner, tokens, create, revoke } = setup();
    const { token } = await create.execute({ adminId: owner.id, name: 'ci', scope: 'read', expiresInDays: 7 }, CTX);
    await revoke.execute({ tokenId: PersonalAccessTokenId.parse(token.tokenId), ownerId: owner.id }, CTX);
    const list = await new ListPersonalAccessTokens({ clock: fixedClock(NOW), tokens }).execute(owner.id);
    expect(list.tokens.map((t) => t.status)).toEqual(['revoked']);
  });
});

describe('Bề mặt /admin với PAT', { timeout: 20_000 }, () => {
  const silent: Logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child: () => silent };
  const callers: Record<string, AdminCaller> = {
    session: { kind: 'admin', adminId: 'a', role: 'user', via: 'session', tokenId: null, scope: null },
    read: { kind: 'admin', adminId: 'a', role: 'user', via: 'pat', tokenId: 't', scope: 'read' },
    write: { kind: 'admin', adminId: 'a', role: 'user', via: 'pat', tokenId: 't', scope: 'write' },
  };

  async function server() {
    const sources: string[] = [];
    const routes: HttpRoutes = (app) => {
      app.get('/things', { config: access('self.read') }, async () => ({ ok: true }));
      app.post('/things', { config: access('self.read') }, async (request) => {
        sources.push(adminContext(request).source);
        return { ok: true };
      });
      app.get('/me/tokens', { config: access('self.read') }, async (request) => {
        requireSession(request);
        return { ok: true };
      });
    };
    const built = await buildHttpServer({
      logger: silent,
      readiness: [],
      authenticators: {
        apiKey: { authenticate: () => Promise.reject(new Error('unused')) },
        admin: { authenticate: async ({ bearerToken }) => callers[bearerToken ?? 'session']! },
      },
      adminAuthorizer: { authorize: async () => ({ isSuperAdmin: false, orgRoles: new Map(), appRoles: new Map() }) },
      surfaces: { admin: [routes] },
    });
    return { app: built.app, sources };
  }
  const call = (app: Awaited<ReturnType<typeof server>>['app'], method: 'GET' | 'POST', url: string, as: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${as}` } });

  it('PAT read: GET được, lệnh ghi -> 403 PAT_SCOPE_INSUFFICIENT và handler không chạy', async () => {
    const { app, sources } = await server();
    expect((await call(app, 'GET', '/admin/things', 'read')).statusCode).toBe(200);
    const denied = await call(app, 'POST', '/admin/things', 'read');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('PAT_SCOPE_INSUFFICIENT');
    expect(sources).toEqual([]);
    await app.close();
  });

  it('PAT write ghi được, nguồn audit là admin_pat; phiên là admin_api', async () => {
    const { app, sources } = await server();
    expect((await call(app, 'POST', '/admin/things', 'write')).statusCode).toBe(200);
    expect((await call(app, 'POST', '/admin/things', 'session')).statusCode).toBe(200);
    expect(sources).toEqual(['admin_pat', 'admin_api']);
    await app.close();
  });

  it('route quản lý PAT chỉ nhận phiên: PAT (kể cả write) -> 403 SESSION_REQUIRED', async () => {
    const { app } = await server();
    expect((await call(app, 'GET', '/admin/me/tokens', 'session')).statusCode).toBe(200);
    const denied = await call(app, 'GET', '/admin/me/tokens', 'write');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('SESSION_REQUIRED');
    await app.close();
  });
});
