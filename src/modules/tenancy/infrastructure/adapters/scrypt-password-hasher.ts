import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../application/ports/index.ts';

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt của `node:crypto` — KHÔNG thêm dependency nào.
 *
 * Cố ý không dùng argon2: nó là package native, phải biên dịch hoặc tải prebuild lúc cài, tức là
 * thêm một đường hỏng vào bản dựng Docker. scrypt cùng họ "chậm + tốn bộ nhớ", có sẵn trong Node.
 * Đổi thuật toán về sau chỉ là thay adapter này — use case thấy port `PasswordHasher`, không đổi.
 *
 * N = 2^15: tốn ~32 MB bộ nhớ và ~100 ms CPU mỗi lần băm. `maxmem` phải nới tay vì mặc định của
 * Node (32 MB) không đủ cho chính N đó.
 */
const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAXMEM = 192 * 1024 * 1024;
const PREFIX = 'scrypt';

/** `scrypt$N$r$p$<salt hex>$<key hex>` — tham số nằm TRONG chuỗi, nên đổi tham số sau này vẫn kiểm được băm cũ. */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scryptAsync(plaintext, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
    return [PREFIX, N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    const parsed = parse(hash);
    if (parsed === null) return false;
    const actual = await scryptAsync(plaintext, parsed.salt, parsed.key.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAXMEM,
    });
    // timingSafeEqual: không để thời gian so sánh tiết lộ đúng được bao nhiêu byte đầu.
    return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
  }
}

function parse(hash: string): { n: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const numbers = [Number(n), Number(r), Number(p)];
  if (numbers.some((v) => !Number.isInteger(v) || v <= 0)) return null;
  if (!/^[0-9a-f]+$/.test(salt) || !/^[0-9a-f]+$/.test(key) || key.length === 0) return null;
  return { n: numbers[0]!, r: numbers[1]!, p: numbers[2]!, salt: Buffer.from(salt, 'hex'), key: Buffer.from(key, 'hex') };
}
