import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, adminContext, doc, EXTERNAL_ID, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
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
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const tag = 'users';

    app.post(
      '/apps/:appId/users',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Add a recipient to an app by hand.',
            description:
              'Unlike `PUT /v1/users/{externalId}`, an existing id is never overwritten (409 `USER_ALREADY_EXISTS`). The id of a soft-deleted recipient restores that recipient. User and email are written in one transaction.',
            params: appParams,
            body: createBody,
            example: { externalId: 'NV-0123', email: 'an.nguyen@company.com' },
            status: 201,
            responseDto: 'UserDto',
            errors: [
              { status: 409, code: 'EMAIL_TAKEN' },
              { status: 409, code: 'USER_ALREADY_EXISTS' },
              { status: 422, code: 'EMAIL_INVALID' },
            ],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const { externalId, email } = parseInput(createBody, request.body);
        const created = await useCases.createUser.execute({ appId: AppId.parse(appId), externalId, email }, ctx(request));
        return reply.status(201).send(created);
      },
    );

    // Xoá MỀM (giữ lịch sử gửi). App khai lại cùng mã qua `/v1` -> khôi phục.
    app.delete(
      '/apps/:appId/users/:externalId',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Soft-delete a recipient.',
            description:
              'Hidden from lists, lookups (404) and sends (`RECIPIENT_NOT_FOUND`); send history and email state are kept. Emails already queued still go out. The app declaring the same id again via `PUT /v1/users/{externalId}` restores the recipient.',
            params: userParams,
            status: 204,
          }),
        },
      },
      async (request, reply) => {
        const { appId, externalId } = parseInput(userParams, request.params);
        await useCases.deleteUser.execute({ appId: AppId.parse(appId), externalId }, ctx(request));
        return reply.status(204).send();
      },
    );

    app.get(
      '/apps/:appId/users',
      {
        config: {
          ...access('app.read'),
          ...doc({ tag, summary: 'List the recipients of an app, paged; `q` matches part of the external id.', params: appParams, query: listQuery, responseDto: 'UserPageDto' }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const { limit, offset, q } = parseInput(listQuery, request.query);
        return useCases.listUsers.execute({ appId: AppId.parse(appId), limit, offset, search: q });
      },
    );

    // Đúng MỘT người, khớp đủ mã — cho trang chi tiết mở thẳng bằng link. Không tái dùng `?q=` của
    // danh sách: ô tìm đó khớp một phần. Cùng use case với `GET /v1/users/:externalId`, không có -> 404.
    app.get(
      '/apps/:appId/users/:externalId',
      { config: { ...access('app.read'), ...doc({ tag, summary: 'Get one recipient by exact external id.', params: userParams, responseDto: 'UserDto' }) } },
      async (request) => {
        const { appId, externalId } = parseInput(userParams, request.params);
        return useCases.findUser.get({ appId: AppId.parse(appId), externalId });
      },
    );
  };
}
