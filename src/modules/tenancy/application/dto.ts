import type { Account } from '../domain/entities/account.ts';
import type { Admin } from '../domain/entities/admin.ts';
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

/** Admin — KHÔNG bao giờ kèm `passwordHash`. */
export interface AdminDto {
  id: string;
  accountId: string;
  email: string;
  role: string;
}

export const toAdminDto = (a: Admin): AdminDto => ({ id: a.id, accountId: a.accountId, email: a.email, role: a.role });

/**
 * Kết quả đăng nhập. `token` là bản GỐC, xuất hiện đúng một lần ở đây rồi đi vào cookie —
 * không log, không vào audit, không lưu lại (cùng quy ước với API key, ADR-0015 §3).
 */
export interface SignInDto {
  token: string;
  expiresAt: string;
  admin: AdminDto;
}
