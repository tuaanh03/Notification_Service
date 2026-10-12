import type { AdminRepository } from '../ports/index.ts';

/** Trần một trang của màn Danh bạ — route ép bằng zod. */
export const MAX_DIRECTORY_PAGE = 100;

/** Một dòng màn Danh bạ — CHỈ thứ Super Admin cần để quyết ai hiện khi thêm thành viên. */
export interface DirectoryPersonDto {
  adminId: string;
  email: string;
  /** Tên từ Microsoft 365 (ADR-0027). `null` = chưa biết. */
  displayName: string | null;
  isSuperAdmin: boolean;
  /** Đã gắn tài khoản Microsoft 365 (qua đồng bộ hoặc đăng nhập M365). */
  m365Linked: boolean;
  memberListed: boolean;
}

export interface DirectoryPeoplePage {
  items: DirectoryPersonDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Màn Danh bạ của Super Admin: mọi tài khoản EWS, phân trang + tìm theo email / tên. Hai truy vấn mỗi trang. */
export class ListDirectoryPeople {
  private readonly deps: { admins: AdminRepository };

  constructor(deps: ListDirectoryPeople['deps']) {
    this.deps = deps;
  }

  async execute(input: { limit: number; offset: number; search?: string | undefined; listed?: boolean | undefined }): Promise<DirectoryPeoplePage> {
    const page = await this.deps.admins.listPage(input);
    return {
      items: page.items.map((a) => ({
        adminId: a.id as string,
        email: a.email as string,
        displayName: a.displayName,
        isSuperAdmin: a.isSuperAdmin,
        m365Linked: a.microsoftOid !== null,
        memberListed: a.memberListed,
      })),
      total: page.total,
      limit: input.limit,
      offset: input.offset,
    };
  }
}
