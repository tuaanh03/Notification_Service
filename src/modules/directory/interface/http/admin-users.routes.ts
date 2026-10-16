import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId } from '../../../../shared/kernel/index.ts';
import { MAX_USER_PAGE, type CreateUser, type DeleteUser, type FindUserByExternalId, type ListUsers } from '../../application/index.ts';

const appParams = z.object({ appId: z.string().uuid() });
const userParams = appParams.extend({ externalId: EXTERNAL_ID });
/** Email tuỳ chọn — cùng giới hạn với `PUT /v1/users/:externalId`; kiểm định dạng ở subscriptions. */
const createBody = z.object({ externalId: EXTERNAL_ID, email: z.string().max(320).optional() }).strict();
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
 * Ghi: người quản lý app THÊM TAY một người (`POST`, `app.manage`) — mã đã có -> 409, không ghi đè — và
 * XOÁ MỀM (`DELETE`). Sửa email / lựa chọn nhận tin vẫn là việc của app service qua `/v1`.
 */
export function adminUsersRoutes(useCases: {
  listUsers: ListUsers;
  findUser: FindUserByExternalId;
  createUser: CreateUser;
  deleteUser: DeleteUser;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });

    app.post('/apps/:appId/users', { config: access('app.manage') }, async (request, reply) => {
      const { appId } = parseInput(appParams, request.params);
      const { externalId, email } = parseInput(createBody, request.body);
      const created = await useCases.createUser.execute({ appId: AppId.parse(appId), externalId, email }, ctx(request));
      return reply.status(201).send(created);
    });

    // Xoá MỀM (giữ lịch sử gửi). App khai lại cùng mã qua `/v1` -> khôi phục.
    app.delete('/apps/:appId/users/:externalId', { config: access('app.manage') }, async (request, reply) => {
      const { appId, externalId } = parseInput(userParams, request.params);
      await useCases.deleteUser.execute({ appId: AppId.parse(appId), externalId }, ctx(request));
      return reply.status(204).send();
    });

    app.get('/apps/:appId/users', { config: access('app.read') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { limit, offset, q } = parseInput(listQuery, request.query);
      return useCases.listUsers.execute({ appId: AppId.parse(appId), limit, offset, search: q });
    });

    // Đúng MỘT người, khớp đủ mã — cho trang chi tiết mở thẳng bằng link. Không tái dùng `?q=` của
    // danh sách: ô tìm đó khớp một phần. Cùng use case với `GET /v1/users/:externalId`, không có -> 404.
    app.get('/apps/:appId/users/:externalId', { config: access('app.read') }, async (request) => {
      const { appId, externalId } = parseInput(userParams, request.params);
      return useCases.findUser.get({ appId: AppId.parse(appId), externalId });
    });
  };
}
