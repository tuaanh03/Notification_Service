import { createHash, createHmac } from 'node:crypto';
import type { HookCrypto } from '../../application/ports/index.ts';

const PREFIX = 'ewshk_';

/**
 * Token = `ewshk_` + HMAC-SHA256(khoá chủ, "incoming-hook-token:<id>:<phiên bản>") base64url (43 ký tự).
 * Không lưu token — tính lại được nên lấy lại URL bất cứ lúc nào; đổi khoá chủ = mọi URL đổi theo (đúng ý:
 * lộ khoá chủ là lộ mọi URL). Chuỗi đầu vào khác hẳn secret outgoing (`webhook-secret:…`) — hai thứ không
 * bao giờ trùng nhau dù chung khoá.
 */
export class NodeHookCrypto implements HookCrypto {
  readonly configured: boolean;
  private readonly signingKey: string | null;

  constructor(deps: { signingKey: string | null | undefined }) {
    this.signingKey = deps.signingKey ?? null;
    this.configured = this.signingKey !== null;
  }

  tokenFor(hookId: string, version: number): { token: string; hash: string; hint: string } {
    if (this.signingKey === null) throw new Error('WEBHOOK_SIGNING_KEY is not configured');
    const token = `${PREFIX}${createHmac('sha256', this.signingKey).update(`incoming-hook-token:${hookId}:${version}`).digest('base64url')}`;
    return { token, hash: this.sha256(token), hint: `${PREFIX}${token.slice(PREFIX.length, PREFIX.length + 4)}…${token.slice(-4)}` };
  }

  sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }
}
