import { NotFoundError, type OrgId } from '../../../../shared/kernel/index.ts';
import type { AdminRepository, OrganizationRepository, OrgMemberRepository } from '../ports/index.ts';

/** Một người có thể thêm vào org — CHỈ thứ hộp "Thêm thành viên" cần. */
export interface MemberCandidateDto {
  adminId: string;
  email: string;
  displayName: string | null;
}

/**
 * Người có thể thêm vào org (ADR-0027): tài khoản cùng account với org mà Super Admin đã tích hiện
 * ở màn Danh bạ, trừ người đã là thành viên.
 * Tài khoản đến từ đồng bộ danh bạ M365 hoặc lần đăng nhập M365 đầu tiên. Ba truy vấn cho cả org.
 */
export class ListMemberCandidates {
  private readonly deps: { organizations: OrganizationRepository; members: OrgMemberRepository; admins: AdminRepository };

  constructor(deps: ListMemberCandidates['deps']) {
    this.deps = deps;
  }

  async execute(orgId: OrgId): Promise<MemberCandidateDto[]> {
    const org = await this.deps.organizations.findById(orgId);
    if (org === null) throw new NotFoundError('organization', orgId);
    const [all, members] = await Promise.all([this.deps.admins.listByAccount(org.accountId), this.deps.members.listByOrg(orgId)]);
    const taken = new Set<string>(members.map((m) => m.adminId));
    return all
      .filter((a) => a.memberListed && !taken.has(a.id))
      .map((a) => ({ adminId: a.id as string, email: a.email as string, displayName: a.displayName }))
      .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email));
  }
}
