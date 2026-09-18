import {
  isEmail,
  normalizeEmail,
  normalizePhone,
  type MatchedOn,
  type NormalizedEmail,
  type NormalizedPhone,
  type PersonId,
} from '../../../shared/kernel/index.ts';

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
 * Hàm thuần: mọi truy vấn đi qua `lookup`, nên test được không cần DB.
 */
export interface PersonLookup {
  byEmail(email: NormalizedEmail): PersonId | null;
  byPhone(phone: NormalizedPhone): PersonId | null;
}

export interface ResolveIdentityInput {
  email?: string | null | undefined;
  phone?: string | null | undefined;
  /** Phone chỉ được dùng làm khoá merge khi đã xác thực OTP. */
  phoneVerified?: boolean | undefined;
}

export type IdentityResolution =
  | { kind: 'matched'; personId: PersonId; matchedOn: MatchedOn; matchedValue: string }
  | { kind: 'create'; primaryEmail: NormalizedEmail; primaryPhone: NormalizedPhone | null }
  | { kind: 'unresolvable'; reason: 'no_deterministic_key' };

export function resolveIdentity(
  input: ResolveIdentityInput,
  lookup: PersonLookup,
): IdentityResolution {
  const email =
    input.email && isEmail(input.email) ? normalizeEmail(input.email) : null;
  const phone =
    input.phone && input.phoneVerified === true ? normalizePhone(input.phone) : null;

  // Ưu tiên 1: email đã chuẩn hoá.
  if (email) {
    const byEmail = lookup.byEmail(email);
    if (byEmail) {
      return { kind: 'matched', personId: byEmail, matchedOn: 'email', matchedValue: email };
    }
  }

  // Ưu tiên 2: số điện thoại đã xác thực OTP.
  if (phone) {
    const byPhone = lookup.byPhone(phone);
    if (byPhone) {
      return { kind: 'matched', personId: byPhone, matchedOn: 'phone', matchedValue: phone };
    }
  }

  // Không khớp nhưng có khoá -> tạo person mới.
  if (email) {
    return { kind: 'create', primaryEmail: email, primaryPhone: phone };
  }

  // Không có khoá deterministic nào -> KHÔNG đoán, để user đứng riêng.
  return { kind: 'unresolvable', reason: 'no_deterministic_key' };
}
