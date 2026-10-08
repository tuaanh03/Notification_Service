import { AccountId, type OrgId } from '../../../../shared/kernel/index.ts';
import type { FindOrganization } from '../../../tenancy/application/index.ts';
import type { OrganizationLookup } from '../../application/ports/index.ts';

/**
 * Adapter xuyên module: apps hỏi tenancy QUA query công khai của tenancy (tầng application), không
 * đọc bảng `organizations`. Mai tenancy tách thành service riêng thì chỉ thay adapter này bằng HTTP.
 */
export class TenancyOrganizationLookup implements OrganizationLookup {
  private readonly findOrganization: FindOrganization;

  constructor(deps: { findOrganization: FindOrganization }) {
    this.findOrganization = deps.findOrganization;
  }

  async findOwner(orgId: OrgId): Promise<{ orgId: OrgId; accountId: AccountId } | null> {
    const org = await this.findOrganization.execute(orgId);
    return org ? { orgId, accountId: AccountId.parse(org.accountId) } : null;
  }

  async list(ids?: readonly OrgId[]): Promise<{ id: string; name: string }[]> {
    return (await this.findOrganization.list(ids)).map((o) => ({ id: o.id, name: o.name }));
  }
}
