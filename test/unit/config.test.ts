import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from '../../src/shared/config/index.ts';

const URL = 'mysql://root:root@localhost:3306/ews_astrolink';
const REDIS = 'redis://localhost:6379';
const REQUIRED = { DATABASE_URL: URL, REDIS_URL: REDIS };

describe('loadEnv — fail-fast', () => {
  it('chỉ có biến bắt buộc thì các biến còn lại lấy mặc định', () => {
    expect(loadEnv(REQUIRED)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL: URL,
      DB_POOL_SIZE: 10,
      REDIS_URL: REDIS,
      WORKER_GROUPS: 'all',
    });
  });

  it('WORKER_GROUPS: danh sách cách nhau bởi dấu phẩy, "all" thắng mọi thứ', () => {
    expect(loadEnv({ ...REQUIRED, WORKER_GROUPS: ' resolver , delivery-email ' }).WORKER_GROUPS).toEqual([
      'resolver',
      'delivery-email',
    ]);
    expect(loadEnv({ ...REQUIRED, WORKER_GROUPS: 'resolver,all' }).WORKER_GROUPS).toBe('all');
  });

  it('ép kiểu số từ chuỗi env', () => {
    const env = loadEnv({ ...REQUIRED, PORT: '8080', DB_POOL_SIZE: '25' });
    expect(env.PORT).toBe(8080);
    expect(env.DB_POOL_SIZE).toBe(25);
  });

  it('thiếu biến bắt buộc -> ConfigError nêu đúng từng biến', () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
    try {
      loadEnv({});
    } catch (err) {
      const fields = (err as ConfigError).issues.map((i) => i.split(':')[0]);
      expect(fields).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL']));
    }
  });

  it('gom MỌI lỗi trong một lần, không dừng ở lỗi đầu tiên', () => {
    try {
      loadEnv({ DATABASE_URL: 'postgres://x', REDIS_URL: 'http://x', PORT: 'abc', LOG_LEVEL: 'verbose' });
      expect.unreachable();
    } catch (err) {
      const fields = (err as ConfigError).issues.map((i) => i.split(':')[0]);
      expect(fields).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'PORT', 'LOG_LEVEL']));
    }
  });

  it('kết quả bị freeze — không ai sửa cấu hình lúc đang chạy', () => {
    expect(Object.isFrozen(loadEnv(REQUIRED))).toBe(true);
  });
});
