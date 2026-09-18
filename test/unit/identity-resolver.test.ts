import { describe, expect, it } from 'vitest';
import { PersonId, normalizeEmail, normalizePhone } from '../../src/shared/kernel/index.ts';
import {
  resolveIdentity,
  type PersonLookup,
} from '../../src/modules/directory/domain/identity-resolver.ts';

const EXISTING = PersonId.create();

function lookup(overrides: Partial<PersonLookup> = {}): PersonLookup {
  return { byEmail: () => null, byPhone: () => null, ...overrides };
}

describe('Identity Resolver', () => {
  it('khớp theo email đã chuẩn hoá', () => {
    const result = resolveIdentity(
      { email: '  Minh@Example.COM ' },
      lookup({ byEmail: (email) => (email === 'minh@example.com' ? EXISTING : null) }),
    );
    expect(result).toEqual({
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
    expect(resolveIdentity({ email: null, phone: null }, lookup())).toEqual({
      kind: 'unresolvable',
      reason: 'no_deterministic_key',
    });
  });

  it('phone CHƯA xác thực OTP không được dùng làm khoá merge', () => {
    const byPhone = () => EXISTING;
    expect(resolveIdentity({ phone: '+84 901 234 567' }, lookup({ byPhone })).kind).toBe(
      'unresolvable',
    );
    expect(
      resolveIdentity({ phone: '+84 901 234 567', phoneVerified: true }, lookup({ byPhone })),
    ).toMatchObject({ kind: 'matched', matchedOn: 'phone' });
  });

  it('email được ưu tiên hơn phone khi cả hai cùng khớp', () => {
    const other = PersonId.create();
    const result = resolveIdentity(
      { email: 'minh@example.com', phone: '+84901234567', phoneVerified: true },
      lookup({ byEmail: () => EXISTING, byPhone: () => other }),
    );
    expect(result).toMatchObject({ kind: 'matched', personId: EXISTING, matchedOn: 'email' });
  });

  it('có email nhưng không khớp ai -> tạo person mới, không gộp bừa', () => {
    const result = resolveIdentity(
      { email: 'new@example.com', phone: '+84901234567', phoneVerified: true },
      lookup(),
    );
    expect(result).toEqual({
      kind: 'create',
      primaryEmail: normalizeEmail('new@example.com'),
      primaryPhone: normalizePhone('+84901234567'),
    });
  });
});
