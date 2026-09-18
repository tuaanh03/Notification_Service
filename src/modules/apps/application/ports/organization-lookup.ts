import type { AccountId, OrgId } from '../../../../shared/kernel/index.ts';

/**
 * Apps cần biết org tồn tại và thuộc account nào (cột `apps.account_id`, ADR-0011). Org thuộc module
 * tenancy -> hỏi qua port; adapter gọi query công khai của tenancy, KHÔNG query bảng `organizations`.
 */
export interface OrganizationLookup {
  findOwner(orgId: OrgId): Promise<{ orgId: OrgId; accountId: AccountId } | null>;
}
