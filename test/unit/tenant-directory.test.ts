import { describe, expect, it } from 'vitest';
import { AccountId, AdminId, DomainError, fixedClock, type NormalizedEmail } from '../../src/shared/kernel/index.ts';
import type { EventOutbox, IntegrationEvent, UnitOfWork } from '../../src/shared/application/index.ts';
import { Account } from '../../src/modules/tenancy/domain/entities/account.ts';
import { Admin } from '../../src/modules/tenancy/domain/entities/admin.ts';
import { SyncTenantDirectory } from '../../src/modules/tenancy/application/commands/sync-tenant-directory.ts';
import type { AdminRepository, DirectoryPerson, TenantDirectory } from '../../src/modules/tenancy/application/ports/index.ts';
import {
  DisabledTenantDirectory,
  GraphTenantDirectory,
  toPerson,
} from '../../src/modules/tenancy/infrastructure/adapters/graph-tenant-directory.ts';

/** Đồng bộ danh bạ M365 (ADR-0027): luật khớp tài khoản + đọc Graph có phân trang. */
const NOW = new Date('2026-10-09T08:00:00.000Z');
const CTX = { actor: { id: 'super', type: 'admin' as const }, source: 'admin_api' as const };
const INSTALL = new Account({ id: AccountId.create(), name: 'EWS', createdAt: NOW });

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return '(không ném lỗi)';
  } catch (err) {
    return err instanceof DomainError ? err.code : String(err);
  }
};

const uow: UnitOfWork = { run: async (work) => work() };
class FakeOutbox implements EventOutbox {
  readonly events: IntegrationEvent[] = [];
  async append(events: readonly IntegrationEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

class FakeAdmins implements AdminRepository {
  readonly rows: Admin[];
  /** Mô phỏng lần đăng nhập đầu song song đã tạo tài khoản cho người này trước. */
  createdConcurrently: Admin | null = null;
  renamed: string[] = [];

  constructor(rows: Admin[]) {
    this.rows = rows;
  }
  async findById(id: string) {
    return this.rows.find((a) => a.id === id) ?? null;
  }
  async findByEmail(email: NormalizedEmail) {
    return this.rows.find((a) => a.email === email) ?? null;
  }
  async findByMicrosoftOid(oid: string) {
    return this.rows.find((a) => a.microsoftOid === oid) ?? null;
  }
  async findManyByIds(ids: readonly string[]) {
    return this.rows.filter((a) => ids.includes(a.id));
  }
  async listByAccount() {
    return this.rows;
  }
  async listPage() {
    return { items: this.rows, total: this.rows.length };
  }
  async updateMemberListed() {}
  async insert() {}
  async insertIfAbsent(admin: Admin) {
    if (this.createdConcurrently !== null) {
      this.rows.push(this.createdConcurrently);
      return false;
    }
    this.rows.push(admin);
    return true;
  }
  async linkMicrosoft() {
    return true;
  }
  async updateDisplayName(admin: Admin) {
    this.renamed.push(admin.id);
  }
  async updatePassword() {}
  async countByAccount() {
    return this.rows.length;
  }
}

const admin = (email: string, microsoftOid: string | null = null, displayName: string | null = null) =>
  new Admin({ id: AdminId.create(), accountId: INSTALL.id, email, role: 'user', microsoftOid, displayName, createdAt: NOW });

const directoryOf = (people: DirectoryPerson[]): TenantDirectory => ({
  configured: true,
  unavailableCode: 'M365_DIRECTORY_NOT_CONFIGURED',
  listPeople: async () => people,
});

function setup(rows: Admin[], people: DirectoryPerson[], directory: TenantDirectory = directoryOf(people)) {
  const admins = new FakeAdmins(rows);
  const outbox = new FakeOutbox();
  const sync = new SyncTenantDirectory({
    uow,
    outbox,
    clock: fixedClock(NOW),
    directory,
    accounts: { findById: async () => INSTALL, insert: async () => {}, listAll: async () => [INSTALL], findOldest: async () => INSTALL },
    admins,
  });
  return { admins, outbox, run: () => sync.execute(CTX) };
}

describe('SyncTenantDirectory', () => {
  it('cùng luật với lần đăng nhập M365 đầu: đổi tên / gắn oid / tạo mới / bỏ qua xung đột', async () => {
    const known = admin('an@company.com', 'oid-an', 'An cũ');
    const unlinked = admin('binh@company.com');
    const other = admin('chi@company.com', 'oid-chi-khac');
    const same = admin('dung@company.com', 'oid-dung', 'Dũng');
    const { admins, outbox, run } = setup(
      [known, unlinked, other, same],
      [
        { oid: 'oid-an', email: 'an.moi@company.com', displayName: 'Nguyễn Văn An' },
        { oid: 'oid-binh', email: 'Binh@Company.com', displayName: 'Trần Bình' },
        { oid: 'oid-chi', email: 'chi@company.com', displayName: 'Chi' },
        { oid: 'oid-dung', email: 'dung@company.com', displayName: 'Dũng' },
        { oid: 'oid-la', email: 'La@Company.com', displayName: 'Lã Thị La' },
        { oid: 'oid-xau', email: 'khong-phai-email@', displayName: null },
      ],
    );

    expect(await run()).toEqual({ total: 5, created: 1, linked: 1, renamed: 1, unchanged: 1, conflicts: 1 });
    // oid thắng email: đổi tên, KHÔNG đổi email.
    expect([known.email, known.displayName]).toEqual(['an@company.com', 'Nguyễn Văn An']);
    expect([unlinked.microsoftOid, unlinked.displayName]).toEqual(['oid-binh', 'Trần Bình']);
    expect(other.microsoftOid).toBe('oid-chi-khac');
    const created = admins.rows.find((a) => a.email === 'la@company.com')!;
    // Người mới từ danh bạ CHƯA hiện khi thêm thành viên — chờ Super Admin tích; người đã có giữ nguyên cờ.
    expect(created).toMatchObject({ role: 'user', passwordHash: null, microsoftOid: 'oid-la', displayName: 'Lã Thị La', memberListed: false });
    expect([known.memberListed, unlinked.memberListed]).toEqual([true, true]);
    expect(created.accountId).toBe(INSTALL.id);

    expect(outbox.events.map((e) => e.eventType)).toEqual(['AdminMicrosoftLinked', 'AdminCreated', 'TenantDirectorySynced']);
    expect(outbox.events[1]?.payload).toMatchObject({ actor: CTX.actor, after: { via: 'm365_directory_sync', hasPassword: false } });
    expect(outbox.events[2]?.payload).toMatchObject({ after: { total: 5, created: 1 } });
  });

  it('chạy lại lần hai: không tạo / gắn thêm gì', async () => {
    const people = [{ oid: 'oid-la', email: 'la@company.com', displayName: 'La' }];
    const first = setup([], people);
    await first.run();
    const again = setup(first.admins.rows, people);
    expect(await again.run()).toMatchObject({ created: 0, linked: 0, renamed: 0, unchanged: 1 });
  });

  it('lần đăng nhập đầu của chính người đó chạy chồng, tạo trước -> đếm là unchanged, không lỗi', async () => {
    const { admins, run } = setup([], [{ oid: 'oid-la', email: 'la@company.com', displayName: 'La' }]);
    admins.createdConcurrently = admin('la@company.com', 'oid-la');
    expect(await run()).toMatchObject({ created: 0, unchanged: 1, conflicts: 0 });
  });

  it('danh bạ tắt -> 503 với mã của nó, không đọc gì', async () => {
    const off = setup([], [], new DisabledTenantDirectory('M365_DIRECTORY_TENANT_MISMATCH'));
    expect(await codeOf(off.run())).toBe('M365_DIRECTORY_TENANT_MISMATCH');
    expect(off.outbox.events).toEqual([]);
  });
});

describe('GraphTenantDirectory', () => {
  it('toPerson: bỏ tài khoản tắt, khách mời, không có email; mail trước UPN', () => {
    const base = { id: 'o1', accountEnabled: true, userType: 'Member', displayName: ' An ', mail: 'an@c.com', userPrincipalName: 'an.upn@c.com' };
    expect(toPerson(base)).toEqual({ oid: 'o1', email: 'an@c.com', displayName: 'An' });
    expect(toPerson({ ...base, mail: null })).toMatchObject({ email: 'an.upn@c.com' });
    expect(toPerson({ ...base, accountEnabled: false })).toBeNull();
    expect(toPerson({ ...base, userType: 'Guest' })).toBeNull();
    expect(toPerson({ ...base, mail: null, userPrincipalName: 'x_gmail.com#EXT#@c.onmicrosoft.com' })).toBeNull();
    expect(toPerson({ ...base, displayName: '' })).toMatchObject({ displayName: null });
  });

  it('lấy token client credentials rồi đi hết các trang', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/oauth2/v2.0/token')) return Response.json({ access_token: 't' });
      const user = (id: string) => ({ id, accountEnabled: true, userType: 'Member', displayName: id, mail: `${id}@c.com` });
      if (url.includes('skiptoken')) return Response.json({ value: [user('b')] });
      return Response.json({ value: [user('a')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=x' });
    }) as typeof fetch;
    const directory = new GraphTenantDirectory({ config: { tenantId: 't', clientId: 'c', clientSecret: 's', timeoutMs: 1000 }, fetch: fetchFn });
    expect((await directory.listPeople()).map((p) => p.oid)).toEqual(['a', 'b']);
    expect(calls).toHaveLength(3);
  });

  it('Graph từ chối -> M365_DIRECTORY_ERROR, message không mang secret hay token', async () => {
    const fetchFn = (async (input: string | URL | Request) =>
      String(input).includes('/token') ? Response.json({ access_token: 'TOKEN-BI-MAT' }) : Response.json({}, { status: 403 })) as typeof fetch;
    const config = { tenantId: 't', clientId: 'c', clientSecret: 'SECRET-BI-MAT', timeoutMs: 1000 };
    const err = (await new GraphTenantDirectory({ config, fetch: fetchFn }).listPeople().catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe('M365_DIRECTORY_ERROR');
    expect(err.message).not.toMatch(/BI-MAT/);
  });
});
