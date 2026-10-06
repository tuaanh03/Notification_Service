import {
  CrossAccountViolationError,
  type AccountId,
  type AdminId,
  type OrgId,
  type OrgRole,
} from '../../../../shared/kernel/index.ts';

export interface OrgMemberProps {
  orgId: OrgId;
  adminId: AdminId;
  /** Account chung của org và admin — denormalize để ép hai composite FK (ADR-0011). */
  accountId: AccountId;
  role: OrgRole;
  createdAt: Date;
  updatedAt: Date;
}

/** Một người trong một org, kèm vai (ADR-0022). Khoá kép (org, admin) nên không kế thừa BaseEntity. */
export class OrgMember {
  readonly orgId: OrgId;
  readonly adminId: AdminId;
  readonly accountId: AccountId;
  role: OrgRole;
  readonly createdAt: Date;
  updatedAt: Date;

  constructor(props: OrgMemberProps) {
    this.orgId = props.orgId;
    this.adminId = props.adminId;
    this.accountId = props.accountId;
    this.role = props.role;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** Org và admin phải cùng account — domain chặn trước, composite FK chặn lần cuối. */
  static join(
    org: { id: OrgId; accountId: AccountId },
    admin: { id: AdminId; accountId: AccountId },
    role: OrgRole,
    at: Date,
  ): OrgMember {
    if (admin.accountId !== org.accountId) throw new CrossAccountViolationError('admin', org.accountId, admin.accountId);
    return new OrgMember({ orgId: org.id, adminId: admin.id, accountId: org.accountId, role, createdAt: at, updatedAt: at });
  }

  changeRole(role: OrgRole, at: Date): void {
    this.role = role;
    this.updatedAt = at;
  }
}
