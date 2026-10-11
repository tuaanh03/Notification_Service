import { createHash, randomBytes } from 'node:crypto';
import type { HookCrypto } from '../../application/ports/index.ts';

const PREFIX = 'ewshk_';

/** Token = `ewshk_` + 32 byte ngẫu nhiên (base64url). Chỉ băm SHA-256 được lưu — như API key. */
export class NodeHookCrypto implements HookCrypto {
  issueToken(): { token: string; hash: string; hint: string } {
    const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
    return { token, hash: this.sha256(token), hint: `${PREFIX}${token.slice(PREFIX.length, PREFIX.length + 4)}…${token.slice(-4)}` };
  }

  sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }
}
