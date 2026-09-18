import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from '../../src/shared/config/index.ts';

const URL = 'mysql://root:root@localhost:3306/ews_astrolink';

describe('loadEnv — fail-fast', () => {
  it('chỉ có DATABASE_URL thì các biến còn lại lấy mặc định', () => {
    expect(loadEnv({ DATABASE_URL: URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL: URL,
      DB_POOL_SIZE: 10,
    });
  });

  it('ép kiểu số từ chuỗi env', () => {
    const env = loadEnv({ DATABASE_URL: URL, PORT: '8080', DB_POOL_SIZE: '25' });
    expect(env.PORT).toBe(8080);
    expect(env.DB_POOL_SIZE).toBe(25);
  });

  it('thiếu DATABASE_URL -> ConfigError nêu đúng biến', () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
    try {
      loadEnv({});
    } catch (err) {
      expect((err as ConfigError).issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
    }
  });

  it('gom MỌI lỗi trong một lần, không dừng ở lỗi đầu tiên', () => {
    try {
      loadEnv({ DATABASE_URL: 'postgres://x', PORT: 'abc', LOG_LEVEL: 'verbose' });
      expect.unreachable();
    } catch (err) {
      const fields = (err as ConfigError).issues.map((i) => i.split(':')[0]);
      expect(fields).toEqual(expect.arrayContaining(['DATABASE_URL', 'PORT', 'LOG_LEVEL']));
    }
  });

  it('kết quả bị freeze — không ai sửa cấu hình lúc đang chạy', () => {
    expect(Object.isFrozen(loadEnv({ DATABASE_URL: URL }))).toBe(true);
  });
});
