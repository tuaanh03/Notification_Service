import type { LoginThrottlePolicy } from '../../domain/rules/login-throttle.ts';
import { LOCK_STREAK_TTL_MS } from '../../domain/rules/login-throttle.ts';
import type { LoginAttemptStore, LoginFailureOutcome, LoginLockEntry } from '../../application/ports/index.ts';

/**
 * Đúng các lệnh Redis cần dùng. Khai kiểu hẹp thay vì import `ioredis` — package đó chỉ được import ở `shared/`
 * (luật kiến trúc); composition truyền client Redis dùng chung vào đây.
 */
export interface RedisLoginCounters {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', n: number): Promise<[string, string[]]>;
}

const PREFIX = 'login';
const failKey = (kind: Kind, subject: string) => `${PREFIX}:fail:${kind}:${subject}`;
const lockKey = (kind: Kind, subject: string) => `${PREFIX}:lock:${kind}:${subject}`;
const streakKey = (subject: string) => `${PREFIX}:streak:e:${subject}`;
type Kind = 'e' | 'ip';

/**
 * Một lần sai: tăng bộ đếm email (+ IP nếu có), chạm ngưỡng thì đặt khoá tạm và xoá bộ đếm; khoá email thì tăng chuỗi
 * khoá liên tiếp. Tất cả trong MỘT script — nhiều bản `api` cùng ghi không lọt quá ngưỡng.
 * Hạn tính từ đồng hồ APPLICATION (`now`), không từ đồng hồ Redis — test chạy với đồng hồ giả.
 * KEYS: failE, lockE, streak, failIp, lockIp (2 khoá IP rỗng = không đếm IP).
 * ARGV: max, windowMs, lockMs, ipMax, now, streakTtlMs. Trả [emailLocked, streak, ipLocked].
 */
const RECORD_SCRIPT = `
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local lockMs = tonumber(ARGV[3])
local ipMax = tonumber(ARGV[4])
local now = tonumber(ARGV[5])
local streakTtl = tonumber(ARGV[6])
local function bump(fail, lock, limit)
  local n = redis.call('INCR', fail)
  if n == 1 then redis.call('PEXPIRE', fail, window) end
  if n >= limit then
    redis.call('SET', lock, now .. ':' .. (now + lockMs), 'PX', lockMs)
    redis.call('DEL', fail)
    return 1
  end
  return 0
end
local emailLocked = bump(KEYS[1], KEYS[2], max)
local streak = tonumber(redis.call('GET', KEYS[3]) or '0')
if emailLocked == 1 then
  streak = redis.call('INCR', KEYS[3])
  redis.call('PEXPIRE', KEYS[3], streakTtl)
end
local ipLocked = 0
if KEYS[4] ~= '' then ipLocked = bump(KEYS[4], KEYS[5], ipMax) end
return { emailLocked, streak, ipLocked }
`;

/**
 * Bộ đếm đăng nhập sai trên Redis (ADR-0039) — MỌI bản `api` cùng thấy, mọi khoá tự hết hạn. Mất Redis chỉ mất các
 * khoá TẠM (khoá hẳn nằm ở MySQL).
 */
export class RedisLoginAttemptStore implements LoginAttemptStore {
  private readonly redis: RedisLoginCounters;

  constructor(deps: { redis: RedisLoginCounters }) {
    this.redis = deps.redis;
  }

  async lockedUntil(subject: string, ip: string | null, now: Date): Promise<Date | null> {
    const keys = ip === null ? [lockKey('e', subject)] : [lockKey('e', subject), lockKey('ip', ip)];
    const values = await this.redis.mget(...keys);
    let latest: Date | null = null;
    for (const value of values) {
      const lock = parseLock(value);
      if (lock !== null && lock.until > now && (latest === null || lock.until > latest)) latest = lock.until;
    }
    return latest;
  }

  async recordFailure(subject: string, ip: string | null, policy: LoginThrottlePolicy, now: Date): Promise<LoginFailureOutcome> {
    const [emailLocked, streak, ipLocked] = (await this.redis.eval(
      RECORD_SCRIPT,
      5,
      failKey('e', subject),
      lockKey('e', subject),
      streakKey(subject),
      ip === null ? '' : failKey('ip', ip),
      ip === null ? '' : lockKey('ip', ip),
      policy.maxFailures,
      policy.windowMs,
      policy.lockMs,
      policy.ipMaxFailures,
      now.getTime(),
      LOCK_STREAK_TTL_MS,
    )) as [number, number, number];
    const until = new Date(now.getTime() + policy.lockMs);
    return {
      emailLockedUntil: Number(emailLocked) === 1 ? until : null,
      streak: Number(streak),
      ipLockedUntil: Number(ipLocked) === 1 ? until : null,
    };
  }

  async clear(subject: string): Promise<void> {
    await this.redis.del(failKey('e', subject), streakKey(subject));
  }

  async list(now: Date): Promise<LoginLockEntry[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${PREFIX}:lock:*`, 'COUNT', 500);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    const entries: LoginLockEntry[] = [];
    keys.forEach((key, i) => {
      const lock = parseLock(values[i] ?? null);
      const match = /^login:lock:(e|ip):(.+)$/.exec(key);
      if (lock === null || match === null || lock.until <= now) return;
      entries.push({ kind: match[1] === 'e' ? 'email' : 'ip', subject: match[2]!, lockedAt: lock.lockedAt, until: lock.until });
    });
    return entries.sort((a, b) => b.lockedAt.getTime() - a.lockedAt.getTime());
  }

  async unlock(kind: 'email' | 'ip', subject: string): Promise<boolean> {
    const k: Kind = kind === 'email' ? 'e' : 'ip';
    const keys = kind === 'email' ? [lockKey(k, subject), failKey(k, subject), streakKey(subject)] : [lockKey(k, subject), failKey(k, subject)];
    const [lock] = await this.redis.mget(lockKey(k, subject));
    await this.redis.del(...keys);
    return lock !== null && lock !== undefined;
  }
}

/** Giá trị khoá: `<lockedAtMs>:<untilMs>`. Hỏng định dạng -> coi như không có khoá. */
function parseLock(value: string | null): { lockedAt: Date; until: Date } | null {
  if (value === null) return null;
  const [a, b] = value.split(':').map(Number);
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lockedAt: new Date(a), until: new Date(b) };
}
