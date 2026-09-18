import type { NetworkRuleKind } from '../../../../shared/kernel/index.ts';

export interface NetworkRuleView {
  kind: NetworkRuleKind;
  value: string;
}

export type NetworkAccess =
  | { allowed: true }
  | { allowed: false; reason: 'IP_NOT_ALLOWED' | 'ORIGIN_NOT_ALLOWED' };

/**
 * Allowlist của app cho `/v1/*` — hàm thuần, application tra rule rồi truyền vào.
 *
 * Luật từng loại, ĐỘC LẬP nhau:
 *   - Chưa khai rule nào của một loại -> loại đó không giới hạn (app mới tạo gọi được ngay).
 *   - Đã khai ít nhất một rule `ip` -> IP gọi tới PHẢI nằm trong danh sách.
 *   - Đã khai rule `origin` và request có header Origin (gọi từ trình duyệt) -> Origin phải khớp.
 *     Request không có Origin (server-to-server) không bị luật origin chặn — luật ip lo phần đó.
 *
 * So khớp chính xác từng giá trị. CIDR (dải IP) để sau, khi có nhu cầu thật.
 */
export function checkNetworkAccess(
  rules: readonly NetworkRuleView[],
  request: { ip: string; origin: string | null },
): NetworkAccess {
  const ips = rules.filter((r) => r.kind === 'ip').map((r) => normalizeIp(r.value));
  if (ips.length > 0 && !ips.includes(normalizeIp(request.ip))) {
    return { allowed: false, reason: 'IP_NOT_ALLOWED' };
  }
  const origins = rules.filter((r) => r.kind === 'origin').map((r) => normalizeOrigin(r.value));
  if (origins.length > 0 && request.origin !== null && !origins.includes(normalizeOrigin(request.origin))) {
    return { allowed: false, reason: 'ORIGIN_NOT_ALLOWED' };
  }
  return { allowed: true };
}

/** Node báo IPv4 qua socket IPv6 dạng `::ffff:10.0.0.1` — so khớp phải coi hai dạng là một. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  return trimmed.startsWith('::ffff:') && trimmed.includes('.') ? trimmed.slice(7) : trimmed;
}

/** Origin so theo scheme + host + port, không phân biệt hoa thường, bỏ `/` cuối. */
function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}
