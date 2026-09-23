import { createHash, randomBytes } from 'node:crypto';
import type { IssuedSessionToken, SessionTokenFactory } from '../../application/ports/index.ts';

/** 256 bit ngẫu nhiên, base64url — cùng cỡ với phần bí mật của API key (ADR-0015 §3). */
const TOKEN_BYTES = 32;

/**
 * Token phiên: ngẫu nhiên mạnh, lưu SHA-256.
 *
 * SHA-256 chứ không scrypt, và điều đó KHÔNG mâu thuẫn với chỗ băm mật khẩu: token 256 bit ngẫu
 * nhiên không dò được dù hash nhanh, còn băm chậm thì phải trả giá ở MỌI request `/admin/*`.
 */
export class RandomSessionTokenFactory implements SessionTokenFactory {
  create(): IssuedSessionToken {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hashOf(token) };
  }

  hashOf(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
