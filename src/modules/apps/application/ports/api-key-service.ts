import type { AppSecretId } from '../../../../shared/kernel/index.ts';

export interface IssuedApiKey {
  secretId: AppSecretId;
  /** Plaintext — trả cho người gọi ĐÚNG MỘT LẦN, không bao giờ lưu, không bao giờ vào log/event. */
  apiKey: string;
  /** Thứ được lưu trong DB. */
  secretHash: string;
  /** Đoạn nhận dạng hiển thị được trên console, ví dụ `ews_1a2b3c4d…x9Yz`. */
  hint: string;
}

/**
 * Sinh / đọc / kiểm API key. Port vì đây là quyết định mật mã (định dạng, thuật toán băm) —
 * application không biết, hạ tầng hiện thực bằng node:crypto.
 */
export interface ApiKeyService {
  issue(): IssuedApiKey;
  /** Tách secret id ra khỏi key để tra đúng MỘT dòng. Sai định dạng -> null. */
  parse(apiKey: string): { secretId: AppSecretId } | null;
  /** So sánh thời gian hằng số. */
  verify(apiKey: string, secretHash: string): boolean;
}
