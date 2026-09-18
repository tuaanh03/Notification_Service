import type { Account } from '../domain/entities/account.ts';
import type { Organization } from '../domain/entities/organization.ts';

/** Hình dạng trả ra ngoài module — route và module khác chỉ thấy DTO, không thấy entity. */
export interface AccountDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface OrganizationDto {
  id: string;
  accountId: string;
  name: string;
  createdAt: string;
}

export const toAccountDto = (a: Account): AccountDto => ({ id: a.id, name: a.name, createdAt: a.createdAt.toISOString() });

export const toOrganizationDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  accountId: o.accountId,
  name: o.name,
  createdAt: o.createdAt.toISOString(),
});
