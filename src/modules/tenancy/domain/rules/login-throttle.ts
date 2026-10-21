/**
 * Luật chặn đăng nhập mật khẩu sai nhiều lần (ADR-0039). Con số do Super Admin chỉnh (cài đặt hệ thống `auth.*`);
 * application đọc rồi đưa vào đây, domain không biết cài đặt nằm ở đâu.
 */
export interface LoginThrottlePolicy {
  enabled: boolean;
  /** Sai chừng này lần cho một email trong khung -> khoá tạm email đó. */
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  /** Sai chừng này lần từ một IP (mọi email cộng lại) trong khung -> khoá tạm IP đó. */
  ipMaxFailures: number;
  /** Khoá tạm chừng này lần liên tiếp -> khoá hẳn tài khoản. 0 = không bao giờ. */
  permanentAfter: number;
}

/** Chuỗi "khoá tạm liên tiếp" chỉ tính trong 24 giờ — sau đó coi như bắt đầu lại. Đăng nhập đúng cũng xoá chuỗi. */
export const LOCK_STREAK_TTL_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;

/** Từ giá trị cài đặt (phút) sang chính sách (mili giây). */
export function loginThrottlePolicy(values: {
  enabled: boolean;
  maxFailures: number;
  windowMinutes: number;
  lockMinutes: number;
  ipMaxFailures: number;
  permanentAfter: number;
}): LoginThrottlePolicy {
  return {
    enabled: values.enabled,
    maxFailures: values.maxFailures,
    windowMs: values.windowMinutes * MINUTE_MS,
    lockMs: values.lockMinutes * MINUTE_MS,
    ipMaxFailures: values.ipMaxFailures,
    permanentAfter: values.permanentAfter,
  };
}

/** Lần khoá tạm thứ `streak` liên tiếp có đẩy thành khoá hẳn không. */
export function shouldLockPermanently(policy: LoginThrottlePolicy, streak: number): boolean {
  return policy.permanentAfter > 0 && streak >= policy.permanentAfter;
}

/**
 * Khoá đăng nhập tính theo email đã hạ chữ thường — kể cả chuỗi không phải email (đếm cả người dò bằng chuỗi rác),
 * nên không dùng `normalizeEmail` (nó ném lỗi với chuỗi sai định dạng).
 */
export function loginSubject(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}
