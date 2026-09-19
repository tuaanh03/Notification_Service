import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_KEYS, loadEnv } from '../../src/shared/config/index.ts';

/**
 * `.env.example` được COMMIT vào git — nơi dễ lọt secret thật nhất (đã xảy ra một lần). Test này là
 * chốt chặn: dán secret vào file mẫu là `npm test` đỏ ngay trên máy, trước khi commit.
 */
const FILE = resolve(import.meta.dirname, '../../.env.example');
const entries: [string, string][] = readFileSync(FILE, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1)];
  });
const values = new Map(entries);

/** Tên biến mang bí mật / định danh tổ chức — giá trị thật chỉ được ở `.env`. */
const SENSITIVE = /SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|PRIVATE|_KEY$|^GRAPH_/;
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Chuỗi dài liền mạch kiểu secret / token (không phải URL, không có khoảng trắng). */
const SECRET_LIKE = /^[A-Za-z0-9~_\-.+/=]{24,}$/;

describe('.env.example — file mẫu được commit', () => {
  it('parse được và không trùng tên biến', () => {
    expect(entries.length).toBeGreaterThan(5);
    expect(new Set(entries.map(([k]) => k)).size).toBe(entries.length);
  });

  it('khai MỌI biến mà code đọc (không lệch so với shared/config/env.ts)', () => {
    expect(ENV_KEYS.filter((key) => !values.has(key))).toEqual([]);
  });

  it('biến nhạy cảm (secret, token, mật khẩu, Graph) LUÔN để trống', () => {
    const leaked = entries.filter(([key, value]) => SENSITIVE.test(key) && value !== '').map(([key]) => key);
    expect(leaked).toEqual([]);
  });

  it('không có giá trị trông như credential thật (GUID, chuỗi dài ngẫu nhiên), dù đặt dưới tên nào', () => {
    const suspicious = entries
      .filter(([, value]) => !value.includes('://') && (GUID.test(value) || SECRET_LIKE.test(value)))
      .map(([key]) => key);
    expect(suspicious).toEqual([]);
  });

  it('URL chỉ trỏ máy local — không dán nhầm địa chỉ môi trường thật', () => {
    const remote = entries
      .filter(([, value]) => value.includes('://'))
      .filter(([, value]) => !['localhost', '127.0.0.1'].includes(new URL(value).hostname))
      .map(([key]) => key);
    expect(remote).toEqual([]);
  });

  // File mẫu được phép để TRỐNG cả biến bắt buộc (người dùng tự điền vào .env). Nhưng giá trị nào đã
  // ghi trong file mẫu thì phải hợp lệ — kiểm bằng cách điền giá trị localhost giả cho biến bắt buộc.
  it('mọi giá trị ghi sẵn trong file mẫu đều hợp lệ với loadEnv', () => {
    const filled = Object.fromEntries(entries.filter(([, value]) => value !== ''));
    const required = { DATABASE_URL: 'mysql://ews:ews@localhost:3306/ews_astrolink', REDIS_URL: 'redis://localhost:6379' };
    expect(() => loadEnv({ ...required, ...filled })).not.toThrow();
  });
});
