import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppSecretId } from '../../../../shared/kernel/index.ts';
import type { ApiKeyService, IssuedApiKey } from '../../application/ports/index.ts';

/**
 * Định dạng key: `ews_<secret id, 32 hex>_<bí mật, 43 ký tự base64url = 256 bit>`.
 *   - secret id nằm trong key -> tra đúng MỘT dòng theo khoá chính, không quét bảng.
 *   - lưu `sha256:<hex>` của cả key, không lưu plaintext.
 *
 * SHA-256 chứ không phải argon2 (lệch tài liệu kiến trúc §13, ghi ở ADR-0015): argon2 sinh ra để làm
 * chậm việc dò MẬT KHẨU người đặt (entropy thấp). Key ở đây là 256 bit ngẫu nhiên — không dò được bằng
 * vét cạn dù hash nhanh — mà argon2 lại tốn ~50 ms CPU cho MỖI request `/v1/*`.
 */
const KEY_RE = /^ews_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const HASH_PREFIX = 'sha256:';

export class CryptoApiKeyService implements ApiKeyService {
  issue(): IssuedApiKey {
    const secretId = AppSecretId.create();
    const idHex = secretId.replaceAll('-', '');
    const secret = randomBytes(32).toString('base64url');
    const apiKey = `ews_${idHex}_${secret}`;
    return { secretId, apiKey, secretHash: hash(apiKey), hint: `ews_${idHex.slice(0, 8)}…${secret.slice(-4)}` };
  }

  parse(apiKey: string): { secretId: AppSecretId } | null {
    const match = KEY_RE.exec(apiKey);
    if (!match) return null;
    const hex = match[1]!;
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return AppSecretId.is(uuid) ? { secretId: AppSecretId.parse(uuid) } : null;
  }

  verify(apiKey: string, secretHash: string): boolean {
    const expected = Buffer.from(secretHash, 'utf8');
    const actual = Buffer.from(hash(apiKey), 'utf8');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

function hash(apiKey: string): string {
  return HASH_PREFIX + createHash('sha256').update(apiKey, 'utf8').digest('hex');
}
