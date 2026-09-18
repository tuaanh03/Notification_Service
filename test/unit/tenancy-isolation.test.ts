import { describe, expect, it } from 'vitest';
import {
  AccountId,
  AdminId,
  AppId,
  CrossAccountViolationError,
  CrossOrgViolationError,
  OrgId,
  PersonId,
  UserId,
} from '../../src/shared/kernel/index.ts';
import { Person } from '../../src/modules/directory/domain/entities/person.ts';
import { User } from '../../src/modules/directory/domain/entities/user.ts';
import { AdminAppRole } from '../../src/modules/tenancy/domain/entities/admin-app-role.ts';

const ORG_A = OrgId.create();
const ORG_B = OrgId.create();

function user(orgId = ORG_A): User {
  return new User({
    id: UserId.create(),
    appId: AppId.create(),
    orgId,
    externalId: 'user_001',
  });
}

function person(orgId = ORG_A): Person {
  return new Person({ id: PersonId.create(), orgId, primaryEmail: 'minh@example.com' });
}

describe('org là ranh giới sở hữu — chống rò rỉ chéo org', () => {
  it('nối user vào person CÙNG org thì được', () => {
    const u = user();
    const p = person();
    u.linkToPerson(p);
    expect(u.personId).toBe(p.id);
  });

  // Domain chặn trước; composite FK (person_id, org_id) trong MySQL chặn lần cuối.
  it('nối user vào person KHÁC org thì bị chặn ngay ở domain', () => {
    const u = user(ORG_A);
    const p = person(ORG_B);
    expect(() => u.linkToPerson(p)).toThrow(CrossOrgViolationError);
    expect(u.personId).toBeNull();
  });

  it('email của person luôn được chuẩn hoá khi dựng', () => {
    const p = new Person({
      id: PersonId.create(),
      orgId: ORG_A,
      primaryEmail: '  Minh@Example.COM  ',
    });
    expect(p.primaryEmail).toBe('minh@example.com');
  });
});

// Cùng loại lỗ với chéo org, nhưng ở tầng quyền. Composite FK chặn lần cuối (ADR-0011).
describe('account là ranh giới của RBAC — chống cấp quyền chéo account', () => {
  const ACCOUNT_X = AccountId.create();
  const ACCOUNT_Y = AccountId.create();
  const AT = new Date('2026-09-18T00:00:00.000Z');

  it('admin và app cùng account thì cấp quyền được', () => {
    const role = AdminAppRole.grant(
      { id: AdminId.create(), accountId: ACCOUNT_X },
      { id: AppId.create(), accountId: ACCOUNT_X },
      'app_admin',
      AT,
    );
    expect(role.accountId).toBe(ACCOUNT_X);
  });

  it('admin của account X không được cấp quyền vào app của account Y', () => {
    expect(() =>
      AdminAppRole.grant(
        { id: AdminId.create(), accountId: ACCOUNT_X },
        { id: AppId.create(), accountId: ACCOUNT_Y },
        'app_admin',
        AT,
      ),
    ).toThrow(CrossAccountViolationError);
  });
});
