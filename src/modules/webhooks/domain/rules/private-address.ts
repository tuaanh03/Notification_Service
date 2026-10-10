/**
 * IP mà webhook KHÔNG được gọi tới (ADR-0029 §7b): EWS chạy trong mạng nội bộ, cho gọi vào đó là
 * biến webhook thành công cụ dò mạng nội bộ. Kiểm cả lúc đăng ký (host là IP viết thẳng) lẫn lúc gọi
 * (IP đã phân giải từ tên miền — tên miền đổi IP sau khi đăng ký được).
 *
 * Nhận IP dạng chữ; chuỗi không phải IP hợp lệ coi là KHÔNG an toàn (chặn) — thà chặn nhầm còn hơn lọt.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!v6.includes(':')) return true;
  if (v6 === '::' || v6 === '::1') return true;
  // IPv4 nhúng trong IPv6 (::ffff:10.0.0.1) — xét theo phần IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1]) {
    const inner = parseIPv4(mapped[1]);
    return inner ? isPrivateIPv4(inner) : true;
  }
  const first = Number.parseInt(v6.split(':')[0] || '0', 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 — mạng riêng
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 — multicast
  return false;
}

function parseIPv4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  return parts.every((p) => p <= 255) ? parts : null;
}

function isPrivateIPv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8 — mạng riêng (EWS ở 10.36.x)
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 — CGNAT
    (a === 169 && b === 254) || // link-local, metadata cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast + dành riêng
  );
}
