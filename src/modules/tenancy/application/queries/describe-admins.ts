import { AdminId } from '../../../../shared/kernel/index.ts';
import type { AdminRepository } from '../ports/index.ts';

/** Tên + email của tài khoản theo id. */
export interface AdminSummary {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Cho module khác cần hiện "ai" theo id tài khoản — nhật ký hoạt động (audit) gắn email vào cột người làm. Theo LÔ, một
 * truy vấn; id không phải uuid (`admin-cli`, `system`…) bị bỏ qua, không lỗi.
 */
export class DescribeAdmins {
  private readonly deps: { admins: AdminRepository };

  constructor(deps: DescribeAdmins['deps']) {
    this.deps = deps;
  }

  async execute(ids: readonly string[]): Promise<AdminSummary[]> {
    const valid = [...new Set(ids)].flatMap((id) => {
      try {
        return [AdminId.parse(id)];
      } catch {
        return [];
      }
    });
    const admins = await this.deps.admins.findManyByIds(valid);
    return admins.map((a) => ({ id: a.id, email: a.email, displayName: a.displayName }));
  }
}
