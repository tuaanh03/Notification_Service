/** Nơi giữ bí mật của một lượt đăng nhập đang dở (`nonce`, `code_verifier`) — dùng một lần, có hạn. */
export interface LoginStateStore {
  save(state: string, value: string, ttlMs: number): Promise<void>;
  /** Lấy VÀ xoá trong một lệnh: cùng một `state` không đổi được mã hai lần. `null` = lạ / hết hạn / đã dùng. */
  take(state: string): Promise<string | null>;
}

/**
 * Đúng hai lệnh Redis cần dùng. Khai kiểu hẹp thay vì import `ioredis` — package đó chỉ được import ở
 * `shared/` (luật kiến trúc); composition truyền client Redis dùng chung vào đây.
 */
export interface RedisKeyValue {
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

/**
 * Giữ trên Redis để MỌI bản `api` đều thấy (đứng sau load balancer, lượt bắt đầu và lượt callback có
 * thể rơi vào hai bản khác nhau). Mất Redis giữa chừng chỉ làm hỏng các lượt đang dở — bấm lại là xong.
 */
export class RedisLoginStateStore implements LoginStateStore {
  private readonly redis: RedisKeyValue;

  constructor(deps: { redis: RedisKeyValue }) {
    this.redis = deps.redis;
  }

  async save(state: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key(state), value, 'PX', ttlMs);
  }

  take(state: string): Promise<string | null> {
    return this.redis.getdel(key(state));
  }
}

const key = (state: string) => `m365:login:${state}`;
