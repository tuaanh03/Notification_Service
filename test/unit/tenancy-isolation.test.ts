import { describe, expect, it } from 'vitest';
import {
  AppId,
  CrossOrgViolationError,
  OrgId,
  PersonId,
  UserId,
} from '../../src/shared/kernel/index.ts';
import { Person } from '../../src/modules/directory/domain/person.ts';
import { User } from '../../src/modules/directory/domain/user.ts';

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
