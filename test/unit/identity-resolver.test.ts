import { describe, expect, it } from 'vitest';
import { PersonId, normalizeEmail, normalizePhone } from '../../src/shared/kernel/index.ts';
import {
  identityKeys,
  resolveIdentity,
  type IdentityMatches,
} from '../../src/modules/directory/domain/rules/identity-resolver.ts';

const EXISTING = PersonId.create();

function matches(overrides: Partial<IdentityMatches> = {}): IdentityMatches {
  return { byEmail: null, byPhone: null, ...overrides };
}

describe('Identity Resolver', () => {
  it('khớp theo email đã chuẩn hoá', () => {
    const keys = identityKeys({ email: '  Minh@Example.COM ' });
    expect(keys.email).toBe('minh@example.com');
    expect(resolveIdentity(keys, matches({ byEmail: EXISTING }))).toEqual({
      kind: 'matched',
      personId: EXISTING,
      matchedOn: 'email',
      matchedValue: 'minh@example.com',
    });
  });

  // Quyết định đã chốt: KHÔNG strip +tag, vì hai hộp thư này là cố ý tách.
  it('không strip +tag — buyer+shop và buyer+seller là hai person khác nhau', () => {
    expect(normalizeEmail('buyer+shop@example.com')).toBe('buyer+shop@example.com');
    expect(normalizeEmail('buyer+shop@example.com')).not.toBe(normalizeEmail('buyer@example.com'));
  });

  it('không có khoá deterministic thì KHÔNG đoán', () => {
    const keys = identityKeys({ email: null, phone: null });
    expect(resolveIdentity(keys, matches())).toEqual({
      kind: 'unresolvable',
      reason: 'no_deterministic_key',
    });
  });

  it('phone CHƯA xác thực OTP không được dùng làm khoá merge', () => {
    const unverified = identityKeys({ phone: '+84 901 234 567' });
    expect(unverified.phone).toBeNull();
    // Kể cả khi application lỡ truyền match vào, khoá không hợp lệ thì không được dùng.
    expect(resolveIdentity(unverified, matches({ byPhone: EXISTING })).kind).toBe('unresolvable');

    const verified = identityKeys({ phone: '+84 901 234 567', phoneVerified: true });
    expect(resolveIdentity(verified, matches({ byPhone: EXISTING }))).toMatchObject({
      kind: 'matched',
      matchedOn: 'phone',
    });
  });

  it('email được ưu tiên hơn phone khi cả hai cùng khớp', () => {
    const keys = identityKeys({ email: 'minh@example.com', phone: '+84901234567', phoneVerified: true });
    const result = resolveIdentity(keys, matches({ byEmail: EXISTING, byPhone: PersonId.create() }));
    expect(result).toMatchObject({ kind: 'matched', personId: EXISTING, matchedOn: 'email' });
  });

  it('có email nhưng không khớp ai -> tạo person mới, không gộp bừa', () => {
    const keys = identityKeys({ email: 'new@example.com', phone: '+84901234567', phoneVerified: true });
    expect(resolveIdentity(keys, matches())).toEqual({
      kind: 'create',
      primaryEmail: normalizeEmail('new@example.com'),
      primaryPhone: normalizePhone('+84901234567'),
    });
  });
});
