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
      TRUST_PROXY: false,
      LOG_LEVEL: 'info',
      DATABASE_URL: URL,
      DB_POOL_SIZE: 10,
      REDIS_URL: REDIS,
      WORKER_GROUPS: 'all',
      EMAIL_PROVIDER: 'mock',
      EMAIL_STUCK_SENDING_AFTER_MS: 600_000,
      EMAIL_MAX_PER_MINUTE: 30,
      EMAIL_SEND_TIMEOUT_MS: 15_000,
    });
  });

  it('EMAIL_PROVIDER=graph thiếu biến kết nối -> dừng khởi động, nêu đủ biến thiếu', () => {
    try {
      loadEnv({ ...REQUIRED, EMAIL_PROVIDER: 'graph', GRAPH_TENANT_ID: 't', GRAPH_CLIENT_SECRET: '' });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).issues.map((i) => i.split(':')[0]).sort()).toEqual([
        'EMAIL_SENDER_ADDRESS',
        'GRAPH_CLIENT_ID',
        'GRAPH_CLIENT_SECRET',
      ]);
    }
  });

  it('EMAIL_PROVIDER=graph đủ biến -> hợp lệ; mock thì không cần biến Graph', () => {
    const graph = { EMAIL_PROVIDER: 'graph', EMAIL_SENDER_ADDRESS: 'noreply@company.com', GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's' };
    expect(loadEnv({ ...REQUIRED, ...graph }).EMAIL_PROVIDER).toBe('graph');
    expect(loadEnv({ ...REQUIRED, GRAPH_TENANT_ID: '' }).GRAPH_TENANT_ID).toBeUndefined();
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

  it('ADMIN_TOKEN rỗng = không cấu hình; có đặt thì phải đủ 32 ký tự', () => {
    expect(loadEnv({ ...REQUIRED, ADMIN_TOKEN: '' }).ADMIN_TOKEN).toBeUndefined();
    expect(() => loadEnv({ ...REQUIRED, ADMIN_TOKEN: 'short' })).toThrow(ConfigError);
    expect(loadEnv({ ...REQUIRED, ADMIN_TOKEN: 'a'.repeat(32) }).ADMIN_TOKEN).toBe('a'.repeat(32));
  });

  it('kết quả bị freeze — không ai sửa cấu hình lúc đang chạy', () => {
    expect(Object.isFrozen(loadEnv(REQUIRED))).toBe(true);
  });
});
