import type { OrgId } from '../../../../shared/kernel/index.ts';
import type { Organization } from '../../domain/entities/organization.ts';

export interface OrganizationRepository {
  findById(id: OrgId): Promise<Organization | null>;
  insert(organization: Organization): Promise<void>;
}
