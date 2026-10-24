import { createHash, randomBytes } from 'node:crypto';
import type { IssuedPersonalAccessToken, PersonalAccessTokenFactory } from '../../application/ports/index.ts';

/** 256 bit ngẫu nhiên, base64url — cùng cỡ token phiên (ADR-0044 §2). */
const TOKEN_BYTES = 32;
const PREFIX = 'ewspat_';

/** PAT: `ewspat_` + 43 ký tự base64url, lưu SHA-256 (token ngẫu nhiên 256 bit không cần băm chậm). */
export class RandomPersonalAccessTokenFactory implements PersonalAccessTokenFactory {
  readonly prefix = PREFIX;

  create(): IssuedPersonalAccessToken {
    const token = PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hashOf(token), hint: `${PREFIX}…${token.slice(-4)}` };
  }

  hashOf(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
