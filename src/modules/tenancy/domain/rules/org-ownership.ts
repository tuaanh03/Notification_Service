import { ConflictError, type OrgRole } from '../../../../shared/kernel/index.ts';

/**
 * Org luôn còn ít nhất MỘT owner (ADR-0022) — hạ vai owner cuối cùng là org mồ côi, không ai quản
 * được thành viên. `owners` phải đếm SAU khi đã khoá dòng org (ADR-0009), nếu không hai lệnh hạ vai
 * chạy song song cùng thấy "còn 2 owner" và cùng hạ.
 */
export function assertOwnerRemains(input: { currentRole: OrgRole | null; nextRole: OrgRole | null; owners: number }): void {
  const losesOwner = input.currentRole === 'owner' && input.nextRole !== 'owner';
  if (losesOwner && input.owners <= 1) {
    throw new ConflictError('LAST_OWNER', 'organization must keep at least one owner');
  }
}
