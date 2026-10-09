import { ConflictError, PermissionDeniedError, type OrgRole } from '../../../../shared/kernel/index.ts';

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

/**
 * Chỉ Owner (hoặc Super Admin) động được vai Owner — trao, hạ, hay gỡ một Owner (ADR-0026). Không
 * có luật này thì Org Admin tự nâng mình lên Owner rồi gỡ Owner thật. `actorIsOwner: undefined`
 * = lệnh hệ thống (`admin-cli` chạy trên máy chủ) — không kiểm.
 */
export function assertMayTouchOwner(input: {
  actorIsOwner: boolean | undefined;
  currentRole: OrgRole | null;
  nextRole: OrgRole | null;
}): void {
  if (input.actorIsOwner !== false) return;
  if (input.currentRole === 'owner' || input.nextRole === 'owner') {
    throw new PermissionDeniedError('OWNER_REQUIRED', 'only an owner can grant, change or remove the owner role');
  }
}
