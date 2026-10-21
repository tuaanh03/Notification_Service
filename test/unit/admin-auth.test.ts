import { describe, expect, it } from 'vitest';
import {
  AccountId,
  AdminId,
  AdminSessionId,
  AuthenticationError,
  ValidationError,
  fixedClock,
  normalizeEmail,
  type Clock,
  type NormalizedEmail,
} from '../../src/shared/kernel/index.ts';
import type { EventOutbox, IntegrationEvent, UnitOfWork } from '../../src/shared/application/index.ts';
import { Admin } from '../../src/modules/tenancy/domain/entities/admin.ts';
import { AdminSession } from '../../src/modules/tenancy/domain/entities/admin-session.ts';
import { assertPasswordAllowed } from '../../src/modules/tenancy/domain/rules/password-policy.ts';
import { LoginAdmin } from '../../src/modules/tenancy/application/commands/login-admin.ts';
import { LoginThrottle } from '../../src/modules/tenancy/application/commands/login-throttle.ts';
import { UnlockLogin } from '../../src/modules/tenancy/application/commands/unlock-login.ts';
import { ListLoginLocks } from '../../src/modules/tenancy/application/queries/list-login-locks.ts';
import { loginThrottlePolicy, type LoginThrottlePolicy } from '../../src/modules/tenancy/domain/rules/login-throttle.ts';
import type { Logger } from '../../src/shared/observability/logger.ts';
import { LogoutAdmin } from '../../src/modules/tenancy/application/commands/logout-admin.ts';
import { AuthenticateAdminSession } from '../../src/modules/tenancy/application/queries/authenticate-admin-session.ts';
import type {
  AdminRepository,
  AdminSessionRepository,
  LoginAttemptStore,
  LoginFailureOutcome,
  LoginLockEntry,
  PasswordHasher,
  SessionTokenFactory,
} from '../../src/modules/tenancy/application/ports/index.ts';
import { ScryptPasswordHasher } from '../../src/modules/tenancy/infrastructure/adapters/scrypt-password-hasher.ts';
import { RandomSessionTokenFactory } from '../../src/modules/tenancy/infrastructure/adapters/random-session-token-factory.ts';

const NOW = new Date('2026-09-23T08:00:00.000Z');
const clock: Clock = fixedClock(NOW);
const TTL = 12 * 60 * 60 * 1000;
const CTX = { actor: { id: 'test', type: 'admin' as const }, source: 'admin_api' as const };

// --- hạ tầng giả: chỉ đủ để chạy use case, không giả lập MySQL ----------------------------
const uow: UnitOfWork = { run: async (work) => work() };
class FakeOutbox implements EventOutbox {
  readonly events: IntegrationEvent[] = [];
  async append(events: readonly IntegrationEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

class FakeAdmins implements AdminRepository {
  private readonly rows: Admin[];

  // Không dùng parameter property: `erasableSyntaxOnly` đang bật (CLAUDE.md mục "Stack đã chốt").
  constructor(rows: Admin[] = []) {
    this.rows = rows;
  }
  async findById(id: string): Promise<Admin | null> {
    return this.rows.find((a) => a.id === id) ?? null;
  }
  async findByEmail(email: NormalizedEmail): Promise<Admin | null> {
    return this.rows.find((a) => a.email === email) ?? null;
  }
  async findByMicrosoftOid(oid: string): Promise<Admin | null> {
    return this.rows.find((a) => a.microsoftOid === oid) ?? null;
  }
  async insert(admin: Admin): Promise<void> {
    this.rows.push(admin);
  }
  async findManyByIds(ids: readonly string[]): Promise<Admin[]> {
    return this.rows.filter((a) => ids.includes(a.id));
  }
  async insertIfAbsent(admin: Admin): Promise<boolean> {
    this.rows.push(admin);
    return true;
  }
  async listByAccount(): Promise<Admin[]> {
    return this.rows;
  }
  async listPage() {
    return { items: this.rows, total: this.rows.length };
  }
  async updateMemberListed() {}
  async updateDisplayName(): Promise<void> {}
  async updatePassword(): Promise<void> {}
  async linkMicrosoft(): Promise<boolean> {
    return true;
  }
  async findManyByEmails(emails: readonly string[]): Promise<Admin[]> {
    return this.rows.filter((a) => emails.includes(a.email));
  }
  async listLocked(): Promise<Admin[]> {
    return this.rows.filter((a) => a.isLocked);
  }
  async updateLock(): Promise<void> {}
  async countByAccount(): Promise<number> {
    return this.rows.length;
  }
}

class FakeSessions implements AdminSessionRepository {
  rows: AdminSession[] = [];
  async insert(session: AdminSession): Promise<void> {
    this.rows.push(session);
  }
  async findByTokenHash(tokenHash: string): Promise<AdminSession | null> {
    return this.rows.find((s) => s.tokenHash === tokenHash) ?? null;
  }
  async deleteById(id: string): Promise<void> {
    this.rows = this.rows.filter((s) => s.id !== id);
  }
  async deleteByAdmin(adminId: string): Promise<void> {
    this.rows = this.rows.filter((s) => s.adminId !== adminId);
  }
}

/** Băm giả, NHANH — test đăng nhập không cần trả giá scrypt thật (đã có test riêng cho nó). */
const fastHasher: PasswordHasher = {
  hash: async (plaintext) => `fake:${plaintext}`,
  verify: async (plaintext, hash) => hash === `fake:${plaintext}`,
};

const tokens: SessionTokenFactory = new RandomSessionTokenFactory();

function adminWithPassword(password: string | null): Admin {
  return new Admin({
    id: AdminId.create(),
    accountId: AccountId.create(),
    email: 'admin@test.local',
    role: 'super_admin',
    passwordHash: password === null ? null : `fake:${password}`,
    createdAt: NOW,
  });
}

/**
 * Bộ đếm giả trong bộ nhớ, cùng luật với script Lua của `RedisLoginAttemptStore` (khoá hết hạn theo `until`, không theo
 * đồng hồ thật). Bản Redis có test tích hợp riêng.
 */
class FakeAttempts implements LoginAttemptStore {
  readonly fails = new Map<string, number>();
  readonly locks = new Map<string, { lockedAt: Date; until: Date }>();
  readonly streaks = new Map<string, number>();
  broken = false;

  async lockedUntil(subject: string, ip: string | null, now: Date): Promise<Date | null> {
    if (this.broken) throw new Error('redis down');
    const all = [this.locks.get(`e:${subject}`), ip === null ? undefined : this.locks.get(`ip:${ip}`)];
    const live = all.filter((l) => l !== undefined && l.until > now).map((l) => l!.until.getTime());
    return live.length === 0 ? null : new Date(Math.max(...live));
  }
  async recordFailure(subject: string, ip: string | null, policy: LoginThrottlePolicy, now: Date): Promise<LoginFailureOutcome> {
    if (this.broken) throw new Error('redis down');
    const until = new Date(now.getTime() + policy.lockMs);
    const bump = (key: string, limit: number): boolean => {
      const n = (this.fails.get(key) ?? 0) + 1;
      if (n < limit) {
        this.fails.set(key, n);
        return false;
      }
      this.fails.delete(key);
      this.locks.set(key, { lockedAt: now, until });
      return true;
    };
    const emailLocked = bump(`e:${subject}`, policy.maxFailures);
    if (emailLocked) this.streaks.set(subject, (this.streaks.get(subject) ?? 0) + 1);
    const ipLocked = ip !== null && bump(`ip:${ip}`, policy.ipMaxFailures);
    return { emailLockedUntil: emailLocked ? until : null, streak: this.streaks.get(subject) ?? 0, ipLockedUntil: ipLocked ? until : null };
  }
  async clear(subject: string): Promise<void> {
    this.fails.delete(`e:${subject}`);
    this.streaks.delete(subject);
  }
  async list(now: Date): Promise<LoginLockEntry[]> {
    return [...this.locks.entries()]
      .filter(([, l]) => l.until > now)
      .map(([key, l]) => ({ kind: key.startsWith('e:') ? 'email' : 'ip', subject: key.slice(key.indexOf(':') + 1), ...l }));
  }
  async unlock(kind: 'email' | 'ip', subject: string): Promise<boolean> {
    const key = `${kind === 'email' ? 'e' : 'ip'}:${subject}`;
    const had = this.locks.delete(key);
    this.fails.delete(key);
    if (kind === 'email') this.streaks.delete(subject);
    return had;
  }
}

const silentLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child: () => silentLogger,
};

const POLICY = loginThrottlePolicy({ enabled: true, maxFailures: 3, windowMinutes: 15, lockMinutes: 15, ipMaxFailures: 10, permanentAfter: 0 });

function throttleWith(
  admins: AdminRepository,
  sessions: AdminSessionRepository,
  outbox: EventOutbox,
  attempts: LoginAttemptStore = new FakeAttempts(),
  policy: LoginThrottlePolicy = POLICY,
): LoginThrottle {
  return new LoginThrottle({ uow, outbox, clock, logger: silentLogger, admins, sessions, attempts, policy: { current: async () => policy } });
}

function loginWith(
  admins: AdminRepository,
  sessions: AdminSessionRepository,
  outbox: EventOutbox,
  throttle: LoginThrottle = throttleWith(admins, sessions, outbox),
): LoginAdmin {
  return new LoginAdmin({
    uow,
    outbox,
    clock,
    admins,
    sessions,
    passwords: fastHasher,
    tokens,
    sessionTtlMs: TTL,
    dummyHash: Promise.resolve('fake:không-ai-dùng'),
    throttle,
  });
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return '(không ném lỗi)';
  } catch (err) {
    return err instanceof AuthenticationError || err instanceof ValidationError ? err.code : String(err);
  }
};

describe('luật mật khẩu', () => {
  it('ngắn hơn 12 ký tự bị từ chối, path trỏ đúng ô', () => {
    try {
      assertPasswordAllowed('ngan');
      expect.unreachable();
    } catch (err) {
      expect((err as ValidationError).issues[0]).toMatchObject({ code: 'PASSWORD_TOO_SHORT', path: 'password' });
    }
  });

  it('dài quá 200 ký tự bị từ chối — băm chậm là chỗ làm nghẽn CPU', () => {
    expect(() => assertPasswordAllowed('x'.repeat(201))).toThrow(ValidationError);
    expect(() => assertPasswordAllowed('x'.repeat(200))).not.toThrow();
  });
});

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('đúng mật khẩu -> true, sai -> false', async () => {
    const hash = await hasher.hash('mat-khau-that-dai');
    expect(await hasher.verify('mat-khau-that-dai', hash)).toBe(true);
    expect(await hasher.verify('mat-khau-khac-dai', hash)).toBe(false);
  });

  it('cùng mật khẩu băm hai lần ra hai chuỗi khác nhau (có salt)', async () => {
    const [a, b] = [await hasher.hash('mat-khau-that-dai'), await hasher.hash('mat-khau-that-dai')];
    expect(a).not.toBe(b);
    expect(await hasher.verify('mat-khau-that-dai', b)).toBe(true);
  });

  it('tham số nằm trong chuỗi băm — đọc lại được để kiểm băm cũ', async () => {
    expect(await hasher.hash('mat-khau-that-dai')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it('băm hỏng định dạng -> false, KHÔNG ném lỗi', async () => {
    for (const broken of ['', 'rac', 'scrypt$a$b$c$d$e', 'argon2$1$2$3$aa$bb']) {
      expect(await hasher.verify('mat-khau-that-dai', broken)).toBe(false);
    }
  });
});

describe('RandomSessionTokenFactory', () => {
  it('mỗi lần một token khác nhau, băm ổn định', () => {
    const [a, b] = [tokens.create(), tokens.create()];
    expect(a.token).not.toBe(b.token);
    expect(tokens.hashOf(a.token)).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('token gốc KHÔNG suy ra được từ băm — hai thứ khác hẳn nhau', () => {
    const issued = tokens.create();
    expect(issued.hash).not.toContain(issued.token);
  });
});

describe('LoginAdmin', () => {
  it('đúng mật khẩu -> tạo phiên, trả token gốc và hạn dùng', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    const sessions = new FakeSessions();
    const outbox = new FakeOutbox();
    const result = await loginWith(new FakeAdmins([admin]), sessions, outbox).execute(
      { email: 'admin@test.local', password: 'mat-khau-that-dai' },
      CTX,
    );

    expect(result.admin.email).toBe('admin@test.local');
    expect(result.expiresAt).toBe(new Date(NOW.getTime() + TTL).toISOString());
    expect(sessions.rows).toHaveLength(1);
    // Bảng lưu BĂM, không lưu token: rò bảng không cho phép mạo danh ai.
    expect(sessions.rows[0]!.tokenHash).toBe(tokens.hashOf(result.token));
    expect(sessions.rows[0]!.tokenHash).not.toBe(result.token);
  });

  it('audit ghi id phiên, KHÔNG ghi token', async () => {
    const outbox = new FakeOutbox();
    const result = await loginWith(new FakeAdmins([adminWithPassword('mat-khau-that-dai')]), new FakeSessions(), outbox).execute(
      { email: 'admin@test.local', password: 'mat-khau-that-dai' },
      CTX,
    );
    expect(outbox.events[0]?.eventType).toBe('AdminSignedIn');
    expect(JSON.stringify(outbox.events)).not.toContain(result.token);
  });

  it('email lạ, sai mật khẩu và admin chưa đặt mật khẩu -> CÙNG một mã lỗi', async () => {
    const login = (admins: Admin[], password: string) =>
      loginWith(new FakeAdmins(admins), new FakeSessions(), new FakeOutbox()).execute(
        { email: 'admin@test.local', password },
        CTX,
      );
    expect(await codeOf(login([], 'mat-khau-that-dai'))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(login([adminWithPassword('mat-khau-that-dai')], 'mat-khau-sai-roi'))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(login([adminWithPassword(null)], 'mat-khau-that-dai'))).toBe('INVALID_CREDENTIALS');
  });

  it('email khác hoa/thường vẫn vào được — email chuẩn hoá trước khi tra', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    const result = await loginWith(new FakeAdmins([admin]), new FakeSessions(), new FakeOutbox()).execute(
      { email: 'ADMIN@Test.Local', password: 'mat-khau-that-dai' },
      CTX,
    );
    expect(result.admin.email).toBe(normalizeEmail('admin@test.local'));
  });
});

describe('Chặn đăng nhập sai nhiều lần (ADR-0039)', () => {
  const PASSWORD = 'mat-khau-that-dai';
  function setup(policy: LoginThrottlePolicy = POLICY) {
    const admin = adminWithPassword(PASSWORD);
    const admins = new FakeAdmins([admin]);
    const sessions = new FakeSessions();
    const outbox = new FakeOutbox();
    const attempts = new FakeAttempts();
    const login = loginWith(admins, sessions, outbox, throttleWith(admins, sessions, outbox, attempts, policy));
    const attempt = (password: string, email = 'admin@test.local', ip: string | null = '203.0.113.7') =>
      codeOf(login.execute({ email, password, ip }, CTX));
    return { admin, admins, sessions, outbox, attempts, attempt };
  }

  it('sai đủ ngưỡng -> khoá tạm: đúng mật khẩu cũng bị từ chối, CÙNG mã lỗi; audit LoginLocked', async () => {
    const { attempt, outbox } = setup();
    for (let i = 0; i < 3; i++) expect(await attempt('sai-mat-khau-roi')).toBe('INVALID_CREDENTIALS');
    expect(await attempt(PASSWORD)).toBe('INVALID_CREDENTIALS');
    const locked = outbox.events.filter((e) => e.eventType === 'LoginLocked');
    expect(locked).toHaveLength(1);
    expect(JSON.stringify(locked[0]!.payload)).toContain('admin@test.local');
  });

  it('dưới ngưỡng -> đúng mật khẩu vẫn vào, và bộ đếm của email được xoá', async () => {
    const { attempt, attempts } = setup();
    await attempt('sai-mat-khau-roi');
    await attempt('sai-mat-khau-roi');
    expect(await attempt(PASSWORD)).toBe('(không ném lỗi)');
    expect(attempts.fails.get('e:admin@test.local')).toBeUndefined();
  });

  it('khoá theo IP: thử nhiều email từ một IP -> IP đó bị chặn, IP khác vẫn vào', async () => {
    const { attempt } = setup({ ...POLICY, maxFailures: 20, ipMaxFailures: 10 });
    for (let i = 0; i < 10; i++) await attempt('sai-mat-khau-roi', `nguoi${i}@test.local`);
    expect(await attempt(PASSWORD, 'admin@test.local', '203.0.113.7')).toBe('INVALID_CREDENTIALS');
    expect(await attempt(PASSWORD, 'admin@test.local', '198.51.100.1')).toBe('(không ném lỗi)');
  });

  it('không biết IP (null) -> chỉ đếm theo email, không gộp mọi người vào một bộ đếm', async () => {
    const { attempt, attempts } = setup();
    await attempt('sai-mat-khau-roi', 'khac@test.local', null);
    expect([...attempts.fails.keys()]).toEqual(['e:khac@test.local']);
  });

  it('tắt chặn -> không đếm, không khoá', async () => {
    const { attempt, attempts } = setup({ ...POLICY, enabled: false });
    for (let i = 0; i < 5; i++) await attempt('sai-mat-khau-roi');
    expect(await attempt(PASSWORD)).toBe('(không ném lỗi)');
    expect(attempts.fails.size).toBe(0);
  });

  it('bộ đếm hỏng (Redis chết) -> vẫn đăng nhập được, không khoá cả hệ thống', async () => {
    const { attempt, attempts } = setup();
    attempts.broken = true;
    expect(await attempt('sai-mat-khau-roi')).toBe('INVALID_CREDENTIALS');
    expect(await attempt(PASSWORD)).toBe('(không ném lỗi)');
  });

  it('khoá tạm đủ N lần liên tiếp -> KHOÁ HẲN: đá mọi phiên, audit AdminLocked, hết khoá tạm vẫn không vào', async () => {
    const { attempt, admin, attempts, sessions, outbox } = setup({ ...POLICY, permanentAfter: 2 });
    sessions.rows.push(
      new AdminSession({ id: AdminSessionId.create(), adminId: admin.id, tokenHash: 'h', expiresAt: new Date(NOW.getTime() + TTL), createdAt: NOW }),
    );
    for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi');
    await attempts.unlock('email', 'admin@test.local');
    attempts.streaks.set('admin@test.local', 1); // giữ chuỗi như khoá tạm tự hết hạn (Redis giữ chuỗi 24 giờ)
    for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi');
    expect(admin.isLocked).toBe(true);
    expect(sessions.rows).toHaveLength(0);
    expect(outbox.events.map((e) => e.eventType)).toContain('AdminLocked');
    attempts.locks.clear();
    expect(await attempt(PASSWORD)).toBe('INVALID_CREDENTIALS');
  });

  it('permanentAfter = 0 (mặc định) -> không bao giờ khoá hẳn', async () => {
    const { attempt, admin, attempts } = setup();
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi');
      attempts.locks.clear();
    }
    expect(admin.isLocked).toBe(false);
  });

  it('email lạ bị khoá tạm -> không audit (không có tài khoản để gắn)', async () => {
    const { attempt, outbox, attempts } = setup();
    for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi', 'khong-co@test.local');
    expect(attempts.locks.has('e:khong-co@test.local')).toBe(true);
    expect(outbox.events).toHaveLength(0);
  });

  it('Super Admin mở khoá: gỡ khoá tạm + khoá hẳn, audit LoginUnlocked; không còn gì để mở -> NOT_FOUND', async () => {
    const { attempt, admin, admins, attempts, outbox } = setup();
    for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi');
    admin.lock(NOW);
    const unlock = new UnlockLogin({ uow, outbox, clock, admins, attempts });
    const actor = { actor: { id: AdminId.create(), type: 'admin' as const }, source: 'admin_api' as const };
    await unlock.execute({ kind: 'email', email: 'ADMIN@test.local' }, actor);
    expect(admin.isLocked).toBe(false);
    expect(await attempt(PASSWORD)).toBe('(không ném lỗi)');
    expect(outbox.events.map((e) => e.eventType)).toContain('LoginUnlocked');
    await expect(unlock.execute({ kind: 'ip', ip: '198.51.100.9' }, actor)).rejects.toThrow(/not found/);
  });

  it('danh sách khoá: khoá hẳn + khoá tạm, email đã khoá hẳn không hiện trùng dòng khoá tạm', async () => {
    const { attempt, admin, admins, attempts } = setup({ ...POLICY, ipMaxFailures: 10 });
    for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi', 'khong-co@test.local');
    for (let i = 0; i < 3; i++) await attempt('sai-mat-khau-roi');
    admin.lock(NOW);
    const locks = await new ListLoginLocks({ clock, admins, attempts }).execute();
    expect(locks.map((l) => `${l.kind}:${l.subject}`).sort()).toEqual(['account:admin@test.local', 'email:khong-co@test.local']);
    expect(locks.find((l) => l.kind === 'account')!.until).toBeNull();
  });
});

describe('AuthenticateAdminSession', () => {
  function setup(session: AdminSession | null, admin: Admin | null) {
    const sessions = new FakeSessions();
    if (session) sessions.rows.push(session);
    return {
      sessions,
      query: new AuthenticateAdminSession({ clock, admins: new FakeAdmins(admin ? [admin] : []), sessions, tokens }),
    };
  }
  const sessionFor = (admin: Admin, token: string, expiresAt: Date) =>
    new AdminSession({
      id: AdminSessionId.create(),
      adminId: admin.id,
      tokenHash: tokens.hashOf(token),
      expiresAt,
      createdAt: NOW,
    });

  it('phiên còn hạn -> trả admin và vai', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    const { query } = setup(sessionFor(admin, 'token-con-han', new Date(NOW.getTime() + 1000)), admin);
    expect(await query.execute({ token: 'token-con-han' })).toMatchObject({ adminId: admin.id, role: 'super_admin' });
  });

  it('thiếu token, token lạ, phiên hết hạn, admin đã xoá -> CÙNG một mã 401', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    const live = sessionFor(admin, 'token-con-han', new Date(NOW.getTime() + 1000));
    const dead = sessionFor(admin, 'token-het-han', new Date(NOW.getTime() - 1));

    expect(await codeOf(setup(live, admin).query.execute({ token: null }))).toBe('INVALID_ADMIN_SESSION');
    expect(await codeOf(setup(live, admin).query.execute({ token: 'token-la' }))).toBe('INVALID_ADMIN_SESSION');
    expect(await codeOf(setup(dead, admin).query.execute({ token: 'token-het-han' }))).toBe('INVALID_ADMIN_SESSION');
    expect(await codeOf(setup(live, null).query.execute({ token: 'token-con-han' }))).toBe('INVALID_ADMIN_SESSION');
  });

  it('admin bị KHOÁ HẲN -> phiên còn hạn cũng hết hiệu lực (ADR-0039)', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    admin.lock(NOW);
    const { query } = setup(sessionFor(admin, 'token-con-han', new Date(NOW.getTime() + 1000)), admin);
    expect(await codeOf(query.execute({ token: 'token-con-han' }))).toBe('INVALID_ADMIN_SESSION');
  });

  it('phiên hết hạn bị XOÁ ngay lúc đụng tới — bảng tự sạch dần', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    const { sessions, query } = setup(sessionFor(admin, 'token-het-han', new Date(NOW.getTime() - 1)), admin);
    await codeOf(query.execute({ token: 'token-het-han' }));
    expect(sessions.rows).toHaveLength(0);
  });
});

describe('LogoutAdmin', () => {
  it('xoá phiên -> token dùng lại không còn hiệu lực', async () => {
    const admin = adminWithPassword('mat-khau-that-dai');
    const sessions = new FakeSessions();
    const outbox = new FakeOutbox();
    const { token } = await loginWith(new FakeAdmins([admin]), sessions, outbox).execute(
      { email: 'admin@test.local', password: 'mat-khau-that-dai' },
      CTX,
    );

    expect(await new LogoutAdmin({ uow, outbox, sessions, tokens }).execute({ token }, CTX)).toEqual({ endedSession: true });
    expect(sessions.rows).toHaveLength(0);

    const query = new AuthenticateAdminSession({ clock, admins: new FakeAdmins([admin]), sessions, tokens });
    expect(await codeOf(query.execute({ token }))).toBe('INVALID_ADMIN_SESSION');
  });

  it('token không có phiên nào -> không lỗi, không phát event (đăng xuất là idempotent)', async () => {
    const outbox = new FakeOutbox();
    const result = await new LogoutAdmin({ uow, outbox, sessions: new FakeSessions(), tokens }).execute(
      { token: 'token-khong-ton-tai' },
      CTX,
    );
    expect(result).toEqual({ endedSession: false });
    expect(outbox.events).toHaveLength(0);
  });
});
