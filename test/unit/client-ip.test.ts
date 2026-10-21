import { describe, expect, it } from 'vitest';
import { trustedClientIp } from '../../src/modules/tenancy/interface/http/client-ip.ts';

const SECRET = 'khoa-chung-dai-it-nhat-32-ky-tu-xx';
const headers = (ip: string | undefined, key: string | undefined) => ({ 'x-ews-client-ip': ip, 'x-ews-client-ip-key': key });

describe('trustedClientIp (ADR-0039)', () => {
  it('khoá khớp + IP hợp lệ -> tin IP; IPv4 dạng ::ffff: gộp về một dạng', () => {
    expect(trustedClientIp(headers('203.0.113.7', SECRET), SECRET)).toBe('203.0.113.7');
    expect(trustedClientIp(headers('::ffff:203.0.113.7', SECRET), SECRET)).toBe('203.0.113.7');
    expect(trustedClientIp(headers('2001:DB8::1', SECRET), SECRET)).toBe('2001:db8::1');
  });

  it('chưa cấu hình khoá, thiếu / sai khoá, IP rác -> null (không bao giờ tự đoán IP)', () => {
    expect(trustedClientIp(headers('203.0.113.7', SECRET), null)).toBeNull();
    expect(trustedClientIp(headers('203.0.113.7', undefined), SECRET)).toBeNull();
    expect(trustedClientIp(headers('203.0.113.7', 'sai-khoa'), SECRET)).toBeNull();
    expect(trustedClientIp(headers('không-phải-ip', SECRET), SECRET)).toBeNull();
    expect(trustedClientIp(headers(undefined, SECRET), SECRET)).toBeNull();
  });
});
