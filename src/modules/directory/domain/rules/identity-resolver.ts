import {
  isEmail,
  normalizeEmail,
  normalizePhone,
  type MatchedOn,
  type NormalizedEmail,
  type NormalizedPhone,
  type PersonId,
} from '../../../../shared/kernel/index.ts';

/**
 * Identity Resolver — quyết định một user thuộc về person nào trong org.
 *
 * NGUYÊN TẮC BẤT DI BẤT DỊCH: chỉ merge bằng DETERMINISTIC MATCH.
 * Khoá hợp lệ: email đã chuẩn hoá, số điện thoại ĐÃ XÁC THỰC OTP.
 * Tuyệt đối không dùng tên, ngày sinh, device fingerprint, IP hay hành vi.
 *
 * Lý do: kênh 1:1 như email/notification mà gộp nhầm thì gửi thông tin riêng tư
 * của người này cho người khác — hậu quả nặng hơn nhiều so với target sai quảng cáo.
 * Tín hiệu mơ hồ -> để thành 2 person, chỉ admin gắn tay nếu cần.
 *
 * Hai bước thuần, việc tra DB nằm giữa và thuộc application (port `PersonLookup`):
 *   1. `identityKeys(input)`            — domain quyết định khoá nào được phép dùng
 *   2. application tra person theo khoá, trong phạm vi org
 *   3. `resolveIdentity(keys, matches)` — domain quyết định matched / create / unresolvable
 */
export interface ResolveIdentityInput {
  email?: string | null | undefined;
  phone?: string | null | undefined;
  /** Phone chỉ được dùng làm khoá merge khi đã xác thực OTP. */
  phoneVerified?: boolean | undefined;
}

/** Khoá deterministic đã chuẩn hoá. `null` = không được dùng khoá đó để merge. */
export interface IdentityKeys {
  email: NormalizedEmail | null;
  phone: NormalizedPhone | null;
}

/** Person đang giữ từng khoá trong org, do application tra qua port. */
export interface IdentityMatches {
  byEmail: PersonId | null;
  byPhone: PersonId | null;
}

export type IdentityResolution =
  | { kind: 'matched'; personId: PersonId; matchedOn: MatchedOn; matchedValue: string }
  | { kind: 'create'; primaryEmail: NormalizedEmail; primaryPhone: NormalizedPhone | null }
  | { kind: 'unresolvable'; reason: 'no_deterministic_key' };

export function identityKeys(input: ResolveIdentityInput): IdentityKeys {
  return {
    email: input.email && isEmail(input.email) ? normalizeEmail(input.email) : null,
    phone: input.phone && input.phoneVerified === true ? normalizePhone(input.phone) : null,
  };
}

export function resolveIdentity(keys: IdentityKeys, matches: IdentityMatches): IdentityResolution {
  // Ưu tiên 1: email đã chuẩn hoá.
  if (keys.email && matches.byEmail) {
    return { kind: 'matched', personId: matches.byEmail, matchedOn: 'email', matchedValue: keys.email };
  }

  // Ưu tiên 2: số điện thoại đã xác thực OTP.
  if (keys.phone && matches.byPhone) {
    return { kind: 'matched', personId: matches.byPhone, matchedOn: 'phone', matchedValue: keys.phone };
  }

  // Không khớp nhưng có khoá -> tạo person mới.
  if (keys.email) {
    return { kind: 'create', primaryEmail: keys.email, primaryPhone: keys.phone };
  }

  // Không có khoá deterministic nào -> KHÔNG đoán, để user đứng riêng.
  return { kind: 'unresolvable', reason: 'no_deterministic_key' };
}
