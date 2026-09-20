import { z } from 'zod';
import { parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId } from '../../../../shared/kernel/index.ts';
import { MAX_USER_PAGE, type ListUsers } from '../../application/index.ts';

const appParams = z.object({ appId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_USER_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Tìm theo `external_id`, khớp một phần. Rỗng = không lọc. */
  q: z.string().trim().max(255).optional(),
});

/**
 * `/admin/apps/:appId/users` — bề mặt ĐỌC cho vận hành (plan §5, ĐX-0004).
 *
 * `appId` nằm trên URL chứ không suy từ token: khi có đăng nhập + RBAC (plan §12.4), vai
 * `app_admin` chỉ cần thêm một lớp kiểm quyền trên chính tham số này.
 *
 * Chỉ đọc — admin KHÔNG sửa được người nhận ở đây. App service tự ghi qua `/v1` bằng khoá của
 * chính nó.
 */
export function adminUsersRoutes(useCases: { listUsers: ListUsers }): HttpRoutes {
  return (app) => {
    app.get('/apps/:appId/users', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { limit, offset, q } = parseInput(listQuery, request.query);
      return useCases.listUsers.execute({ appId: AppId.parse(appId), limit, offset, search: q });
    });
  };
}
