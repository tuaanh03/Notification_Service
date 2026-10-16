import type { HttpRoutes } from '../../../../shared/http/index.ts';
import type { RecordEmailOpen } from '../../application/index.ts';

/** GIF 1×1 trong suốt (42 byte). */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * `GET /t/o/:notificationId/:sig.gif` — bề mặt CÔNG KHAI, không khoá: ảnh theo dõi trong thư (ADR-0031).
 * LUÔN trả cùng một ảnh, kể cả URL sai — người ngoài không dò được URL nào là thật. Cấm cache để mỗi
 * lần mở là một lần tải (proxy ảnh của nhà mail vẫn có thể cache — con số chỉ là ước lượng).
 */
export function publicTrackingRoutes(useCases: { recordOpen: RecordEmailOpen }): HttpRoutes {
  return (app) => {
    app.get('/t/o/:notificationId/:file', async (request, reply) => {
      const { notificationId, file } = request.params as { notificationId: string; file: string };
      if (file.endsWith('.gif') && file.length <= 100) {
        await useCases.recordOpen.execute({ notificationId, signature: file.slice(0, -'.gif'.length) });
      }
      return reply
        .header('content-type', 'image/gif')
        .header('cache-control', 'no-store, no-cache, must-revalidate, private')
        .header('pragma', 'no-cache')
        .send(PIXEL);
    });
  };
}
