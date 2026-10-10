import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { WebhookCallResult, WebhookTransport } from '../../application/ports/index.ts';
import { isPrivateAddress } from '../../domain/rules/private-address.ts';

/** Một lần gọi (kết nối + chờ trả lời) tối đa chừng này — ADR-0029 §5. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

class BlockedAddressError extends Error {
  constructor() {
    super('blocked_private_address');
  }
}

/**
 * Phân giải DNS rồi TỪ CHỐI nếu bất kỳ địa chỉ nào là IP nội bộ (ADR-0029 §7b). Cắm vào `lookup` của
 * chính kết nối — IP đã kiểm là IP được kết nối, tên miền không đổi IP được giữa lúc kiểm và lúc gọi.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 0);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new BlockedAddressError(), '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0]!;
    return callback(null, first.address, first.family);
  });
};

/**
 * Gọi `POST` ra URL của app qua HTTPS. Không đi theo redirect (3xx = lỗi), không đọc body phản hồi,
 * không ghi body / header ra log. Mọi lỗi đổi thành `failed` có mã ngắn — không ném.
 */
export class HttpsWebhookTransport implements WebhookTransport {
  private readonly timeoutMs: number;

  constructor(deps: { timeoutMs?: number | undefined } = {}) {
    this.timeoutMs = deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  }

  post(input: { url: string; body: string; headers: Readonly<Record<string, string>> }): Promise<WebhookCallResult> {
    const target = new URL(input.url);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 && isPrivateAddress(host)) {
      return Promise.resolve({ kind: 'failed', statusCode: null, error: 'blocked_private_address' });
    }
    return new Promise((resolve) => {
      const req = request(
        target,
        {
          method: 'POST',
          headers: { ...input.headers, 'content-length': String(new TextEncoder().encode(input.body).length) },
          lookup: guardedLookup,
          signal: AbortSignal.timeout(this.timeoutMs),
        },
        (res) => {
          const statusCode = res.statusCode ?? 0;
          res.destroy();
          resolve(
            statusCode >= 200 && statusCode < 300
              ? { kind: 'ok', statusCode }
              : { kind: 'failed', statusCode, error: `http_${statusCode}` },
          );
        },
      );
      req.on('error', (err: NodeJS.ErrnoException) => {
        const error =
          err instanceof BlockedAddressError
            ? 'blocked_private_address'
            : err.name === 'AbortError' || err.name === 'TimeoutError'
              ? 'timeout'
              : `connection_failed${err.code ? `: ${err.code}` : ''}`;
        resolve({ kind: 'failed', statusCode: null, error });
      });
      req.end(input.body);
    });
  }
}
