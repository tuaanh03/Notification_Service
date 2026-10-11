import { dedupeValue, stableStringify } from '../../domain/rules/index.ts';
import type { HookCrypto } from '../ports/index.ts';

/**
 * Khoá chống trùng của MỘT lần gọi (ADR-0030 §5), theo thứ tự: header `Idempotency-Key` > giá trị ở
 * đường dẫn đã khai > băm body (khoá object xếp thứ tự) + khung thời gian cố định trong Cài đặt hệ thống.
 * Khoá cuối có tiền tố id hook — hai hook không bao giờ nuốt lần phát của nhau.
 */
export function dedupeKeyOf(
  crypto: HookCrypto,
  input: { hookId: string; body: unknown; header: string | null; dedupePath: string | null; at: Date; windowMinutes: number },
): { source: 'header' | 'path' | 'body_hash'; value: string | null; key: string } {
  const header = input.header?.trim() ? input.header.trim() : null;
  const fromPath = header === null ? dedupeValue(input.body, input.dedupePath) : null;
  const source = header !== null ? 'header' : fromPath !== null ? 'path' : 'body_hash';
  const material =
    source === 'header'
      ? `header:${header}`
      : source === 'path'
        ? `path:${fromPath}`
        : `body:${crypto.sha256(stableStringify(input.body))}:${Math.floor(input.at.getTime() / (input.windowMinutes * 60_000))}`;
  return { source, value: header ?? fromPath, key: `hook:${input.hookId}:${crypto.sha256(material)}` };
}
