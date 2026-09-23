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
import { LogoutAdmin } from '../../src/modules/tenancy/application/commands/logout-admin.ts';
import { AuthenticateAdminSession } from '../../src/modules/tenancy/application/queries/authenticate-admin-session.ts';
import type {
  AdminRepository,
  AdminSessionRepository,
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
  async insert(admin: Admin): Promise<void> {
    this.rows.push(admin);
  }
  async updatePassword(): Promise<void> {}
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

function loginWith(admins: AdminRepository, sessions: AdminSessionRepository, outbox: EventOutbox): LoginAdmin {
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
