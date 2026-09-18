import type {
  NormalizedEmail,
  NormalizedPhone,
  OrgId,
  PersonId,
} from '../../../../shared/kernel/index.ts';

/**
 * Tra person đang giữ một khoá deterministic, trong phạm vi MỘT org.
 * Org là ranh giới hợp nhất person — không bao giờ tra chéo org.
 *
 * Email được `uq_persons_org_email` bảo đảm tối đa 1 person. Phone CHƯA có unique index
 * tương ứng — adapter phải tự xử lý khi có nhiều person trùng phone.
 * Kết quả đưa vào `resolveIdentity()` ở domain; port này không tự quyết định merge.
 */
export interface PersonLookup {
  findByEmail(orgId: OrgId, email: NormalizedEmail): Promise<PersonId | null>;
  findByPhone(orgId: OrgId, phone: NormalizedPhone): Promise<PersonId | null>;
}
