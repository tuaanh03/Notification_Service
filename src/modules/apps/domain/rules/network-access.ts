import type { NetworkRuleKind } from '../../../../shared/kernel/index.ts';

export interface NetworkRuleView {
  kind: NetworkRuleKind;
  value: string;
}

export type NetworkAccess = { allowed: true } | { allowed: false; reason: 'IP_NOT_ALLOWED' };

/**
 * Allowlist IP của app cho `/v1/*` và `/hooks/*` — hàm thuần, application tra rule rồi truyền vào.
 *
 *   - Chưa khai rule nào -> không giới hạn (app mới tạo gọi được ngay).
 *   - Đã khai ít nhất một IP -> IP gọi tới PHẢI nằm trong danh sách.
 *
 * Không có luật Origin: header Origin chỉ trình duyệt gửi, còn API key bắt buộc nằm ở server của app —
 * luật đó chỉ chặn được trường hợp vốn đã cấm, ai cầm khoá bỏ header là qua (bổ sung ADR-0023).
 * So khớp chính xác từng giá trị. CIDR (dải IP) để sau, khi có nhu cầu thật.
 */
export function checkNetworkAccess(rules: readonly NetworkRuleView[], request: { ip: string }): NetworkAccess {
  const ips = rules.filter((r) => r.kind === 'ip').map((r) => normalizeIp(r.value));
  if (ips.length > 0 && !ips.includes(normalizeIp(request.ip))) {
    return { allowed: false, reason: 'IP_NOT_ALLOWED' };
  }
  return { allowed: true };
}

/** Node báo IPv4 qua socket IPv6 dạng `::ffff:10.0.0.1` — so khớp phải coi hai dạng là một. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  return trimmed.startsWith('::ffff:') && trimmed.includes('.') ? trimmed.slice(7) : trimmed;
}
