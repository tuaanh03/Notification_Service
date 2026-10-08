import type { OrgId } from '../../../../shared/kernel/index.ts';
import type { Organization } from '../../domain/entities/organization.ts';

export interface OrganizationRepository {
  findById(id: OrgId): Promise<Organization | null>;
  /** `ids` bỏ trống = mọi org (cho Super Admin). Sắp theo tên. */
  list(ids?: readonly OrgId[] | undefined): Promise<Organization[]>;
  insert(organization: Organization): Promise<void>;
  /** `SELECT ... FOR UPDATE` trên dòng org — tuần tự hoá thay đổi thành viên (ADR-0009). Chỉ gọi trong `uow.run`. */
  lockForUpdate(id: OrgId): Promise<boolean>;
}
