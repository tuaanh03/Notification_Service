import { ValidationError } from '../../../../shared/kernel/index.ts';
import { isPrivateAddress } from './private-address.ts';

export const MAX_WEBHOOK_URL_LENGTH = 2048;

/**
 * URL nhận webhook (ADR-0029 §7b). Chặn sớm những gì chắc chắn không gọi được / không được gọi:
 * không phải https, có user:pass (lộ trong log của bên nhận), có `#…`, host là `localhost` hay IP nội
 * bộ viết thẳng. Tên miền trỏ vào IP nội bộ chỉ bắt được LÚC GỌI (phân giải DNS) — xem transport.
 */
export function parseWebhookUrl(raw: string): string {
  const fail = (message: string) => ValidationError.of('WEBHOOK_URL_INVALID', message, 'url');
  if (raw.length > MAX_WEBHOOK_URL_LENGTH) throw fail(`url must be at most ${MAX_WEBHOOK_URL_LENGTH} characters`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw fail('url is not a valid URL');
  }
  if (url.protocol !== 'https:') throw fail('url must use https://');
  if (url.username !== '' || url.password !== '') throw fail('url must not contain credentials');
  if (url.hash !== '') throw fail('url must not contain a fragment');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw fail('url must not point to localhost');
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
  if (isIpLiteral && isPrivateAddress(host)) throw fail('url must not point to a private network address');
  return url.toString();
}
