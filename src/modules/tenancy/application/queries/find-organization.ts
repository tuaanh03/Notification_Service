import type { OrgId } from '../../../../shared/kernel/index.ts';
import { toOrganizationDto, type OrganizationDto } from '../dto.ts';
import type { OrganizationRepository } from '../ports/index.ts';

/**
 * Query công khai của tenancy — cũng là cửa DUY NHẤT để module khác (qua adapter của nó) hỏi về
 * org. Không module nào query bảng `organizations` trực tiếp.
 */
export class FindOrganization {
  private readonly organizations: OrganizationRepository;

  constructor(deps: { organizations: OrganizationRepository }) {
    this.organizations = deps.organizations;
  }

  async execute(id: OrgId): Promise<OrganizationDto | null> {
    const org = await this.organizations.findById(id);
    return org ? toOrganizationDto(org) : null;
  }
}
