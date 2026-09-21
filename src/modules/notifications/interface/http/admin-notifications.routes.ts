import { z } from 'zod';
import { EXTERNAL_ID, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AppId, NOTIFICATION_STATUSES } from '../../../../shared/kernel/index.ts';
import { MAX_NOTIFICATION_PAGE, type ListNotifications } from '../../application/index.ts';

const appParams = z.object({ appId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  /** `key` của chủ đề, khớp đúng. */
  topic: z.string().min(1).max(128).optional(),
  /** Mã người nhận phía app, khớp đúng. */
  externalId: EXTERNAL_ID.optional(),
});

/**
 * `/admin/apps/:appId/notifications` — bề mặt ĐỌC cho vận hành (plan §5): lịch sử gửi của một app.
 *
 * `appId` nằm trên URL chứ không suy từ token, cùng lý do với `/admin/apps/:appId/users`: khi có
 * RBAC (plan §12.4), vai `app_admin` chỉ cần thêm một lớp kiểm quyền trên chính tham số này.
 *
 * Chỉ đọc — không huỷ, không gửi lại. MVP không có lệnh nào như vậy.
 */
export function adminNotificationsRoutes(useCases: { list: ListNotifications }): HttpRoutes {
  return (app) => {
    app.get('/apps/:appId/notifications', async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const { limit, offset, status, topic, externalId } = parseInput(listQuery, request.query);
      return useCases.list.execute({ appId: AppId.parse(appId), limit, offset, status, topic, externalId });
    });
  };
}
