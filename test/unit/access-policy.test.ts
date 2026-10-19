import { describe, expect, it } from 'vitest';
import { ConflictError, decide, type AdminAccess, type AppRole, type OrgRole, type Permission } from '../../src/shared/kernel/index.ts';
import { assertMayTouchOwner, assertOwnerRemains } from '../../src/modules/tenancy/domain/rules/org-ownership.ts';

const ORG = 'org-a';
const APP = 'app-1';
const OTHER_APP = 'app-2';
const onApp = { orgId: ORG, appId: APP };

const user = (orgRole?: OrgRole, appRole?: AppRole): AdminAccess => ({
  isSuperAdmin: false,
  orgRoles: new Map(orgRole ? [[ORG, orgRole]] : []),
  appRoles: new Map(appRole ? [[APP, appRole]] : []),
});

describe('decide() — luật phân quyền /admin (ADR-0022)', () => {
  it('Super Admin làm được mọi thứ, kể cả việc cấp hệ thống', () => {
    const superAdmin: AdminAccess = { isSuperAdmin: true, orgRoles: new Map(), appRoles: new Map() };
    for (const p of ['platform.manage', 'app.review', 'app.manage'] as Permission[]) {
      expect(decide(superAdmin, p, onApp)).toBe('allow');
      expect(decide(superAdmin, p, null)).toBe('allow');
    }
  });

  it('người ngoài org -> hidden (404), DÙ có dòng vai app sót lại', () => {
    expect(decide(user(), 'app.read', onApp)).toBe('hidden');
    expect(decide(user(undefined, 'app_admin'), 'app.read', onApp)).toBe('hidden');
    expect(decide(user(), 'org.read', { orgId: ORG })).toBe('hidden');
  });

  it('việc cấp hệ thống (không thuộc org nào) -> deny với mọi người không phải Super Admin', () => {
    expect(decide(user('owner'), 'platform.manage', null)).toBe('deny');
  });

  it('xem vai của chính mình: ai đăng nhập cũng được, kể cả chưa thuộc org nào', () => {
    expect(decide(user(), 'self.read', null)).toBe('allow');
  });

  it('tạo org mới: ai đăng nhập cũng được, kể cả chưa thuộc org nào (ADR-0025)', () => {
    expect(decide(user(), 'org.create', null)).toBe('allow');
  });

  it('đọc thư viện mẫu template: ai đăng nhập cũng được, kể cả chưa thuộc org nào (ADR-0035)', () => {
    expect(decide(user(), 'catalog.read', null)).toBe('allow');
  });

  it('quản lý thành viên org (org.manage): Owner, Org Admin; Member 403, người ngoài 404 (ADR-0026)', () => {
    expect(decide(user('owner'), 'org.manage', { orgId: ORG })).toBe('allow');
    expect(decide(user('org_admin'), 'org.manage', { orgId: ORG })).toBe('allow');
    expect(decide(user('member', 'app_admin'), 'org.manage', onApp)).toBe('deny');
    expect(decide(user(), 'org.manage', { orgId: ORG })).toBe('hidden');
  });

  it('Owner / Org Admin: ngầm là App Admin trên MỌI app của org (kế thừa, không lưu dòng)', () => {
    for (const role of ['owner', 'org_admin'] as OrgRole[]) {
      expect(decide(user(role), 'app.read', { orgId: ORG, appId: OTHER_APP })).toBe('allow');
      expect(decide(user(role), 'app.manage', { orgId: ORG, appId: OTHER_APP })).toBe('allow');
      expect(decide(user(role), 'app.create', { orgId: ORG })).toBe('allow');
    }
  });

  it('Member: chỉ app được cấp vai; App Viewer xem, App Admin cấu hình', () => {
    expect(decide(user('member'), 'org.read', { orgId: ORG })).toBe('allow');
    expect(decide(user('member'), 'app.create', { orgId: ORG })).toBe('deny');
    expect(decide(user('member'), 'app.read', { orgId: ORG, appId: OTHER_APP })).toBe('deny');
    expect(decide(user('member', 'app_viewer'), 'app.read', onApp)).toBe('allow');
    expect(decide(user('member', 'app_viewer'), 'app.manage', onApp)).toBe('deny');
    expect(decide(user('member', 'app_admin'), 'app.manage', onApp)).toBe('allow');
  });

  it('duyệt app: chỉ Super Admin — Owner cũng không', () => {
    expect(decide(user('owner'), 'app.review', onApp)).toBe('deny');
    expect(decide(user('member', 'app_admin'), 'app.review', onApp)).toBe('deny');
  });
});

describe('assertOwnerRemains — org luôn còn ít nhất một owner', () => {
  const lastOwner = (currentRole: OrgRole | null, nextRole: OrgRole | null, owners: number) => () =>
    assertOwnerRemains({ currentRole, nextRole, owners });

  it('hạ vai owner CUỐI CÙNG -> LAST_OWNER', () => {
    expect(lastOwner('owner', 'org_admin', 1)).toThrow(ConflictError);
    expect(lastOwner('owner', null, 1)).toThrow(/at least one owner/);
  });

  it('còn owner khác, hoặc không đụng tới owner -> được', () => {
    expect(lastOwner('owner', 'member', 2)).not.toThrow();
    expect(lastOwner('owner', 'owner', 1)).not.toThrow();
    expect(lastOwner('member', 'owner', 0)).not.toThrow();
    expect(lastOwner(null, 'member', 0)).not.toThrow();
  });
});

describe('assertMayTouchOwner — chỉ Owner động được vai Owner (ADR-0026)', () => {
  const touch = (actorIsOwner: boolean | undefined, currentRole: OrgRole | null, nextRole: OrgRole | null) => () =>
    assertMayTouchOwner({ actorIsOwner, currentRole, nextRole });

  it('không phải Owner: trao / hạ / gỡ Owner -> OWNER_REQUIRED', () => {
    expect(touch(false, 'member', 'owner')).toThrow(/only an owner/);
    expect(touch(false, 'owner', 'member')).toThrow(/only an owner/);
    expect(touch(false, 'owner', null)).toThrow(/only an owner/);
  });

  it('không phải Owner nhưng không đụng Owner -> được; Owner hoặc lệnh hệ thống -> luôn được', () => {
    expect(touch(false, 'member', 'org_admin')).not.toThrow();
    expect(touch(false, null, 'member')).not.toThrow();
    expect(touch(true, 'owner', null)).not.toThrow();
    expect(touch(undefined, 'member', 'owner')).not.toThrow();
  });
});
