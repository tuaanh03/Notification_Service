import type { AppId } from '../../../../shared/kernel/index.ts';
import { toUserDto, type UserPageDto } from '../dto.ts';
import type { UserEmailPort, UserRepository } from '../ports/index.ts';

/** Giới hạn cứng: bề mặt đọc không được biến thành đường kéo cả sổ người nhận về một lần. */
export const MAX_USER_PAGE = 200;

/**
 * Liệt kê người nhận của MỘT app, cho màn quản trị (ĐX-0004 — bề mặt đọc cho vận hành).
 *
 * Email lấy theo LÔ qua `emails.findMany`: một truy vấn cho cả trang, không phải mỗi người một
 * lần. Người chưa có email -> `email: null`, vẫn hiện trên màn (câu hỏi "sao anh A không nhận
 * được thư" thường có đáp án đúng là "anh ấy chưa khai email").
 */
export class ListUsers {
  private readonly deps: { users: UserRepository; emails: UserEmailPort };

  constructor(deps: ListUsers['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; limit: number; offset: number; search?: string | undefined }): Promise<UserPageDto> {
    const limit = Math.min(input.limit, MAX_USER_PAGE);
    const page = await this.deps.users.listByApp(input.appId, { limit, offset: input.offset, search: input.search });
    const emails = await this.deps.emails.findMany({
      appId: input.appId,
      userIds: page.rows.map((user) => user.id),
    });
    return {
      rows: page.rows.map((user) => toUserDto(user, emails.get(user.id) ?? null)),
      total: page.total,
      limit,
      offset: input.offset,
    };
  }
}
