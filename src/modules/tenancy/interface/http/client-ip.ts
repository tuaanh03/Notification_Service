import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/** Console (server Next.js) chuyển IP của trình duyệt qua hai header này (ADR-0039). */
export const CLIENT_IP_HEADER = 'x-ews-client-ip';
export const CLIENT_IP_KEY_HEADER = 'x-ews-client-ip-key';

/**
 * IP thật của người đăng nhập, hoặc `null` khi không tin được.
 *
 * Đăng nhập đi trình duyệt -> server console -> API, nên `request.ip` luôn là IP của container console: đếm theo nó
 * là gộp cả công ty vào một bộ đếm. Console gửi IP kèm khoá chung `LOGIN_CLIENT_IP_SECRET`; chỉ tin header khi khoá
 * khớp. Chưa cấu hình khoá, thiếu, sai khoá, IP sai định dạng -> `null` (chỉ đếm theo email, KHÔNG BAO GIỜ rơi về
 * `request.ip`).
 */
export function trustedClientIp(headers: Readonly<Record<string, string | string[] | undefined>>, secret: string | null): string | null {
  if (secret === null) return null;
  const key = single(headers[CLIENT_IP_KEY_HEADER]);
  const ip = single(headers[CLIENT_IP_HEADER])?.trim().toLowerCase();
  if (key === undefined || ip === undefined || !sameSecret(key, secret)) return null;
  if (isIP(ip) === 0) return null;
  // Node / proxy có thể viết IPv4 dạng `::ffff:10.0.0.1` — gộp về một dạng để cùng một bộ đếm.
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip;
}

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** So sánh thời gian hằng — băm trước để hai chuỗi luôn cùng độ dài. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
