/** Danh tính Microsoft đã kiểm (chữ ký, tenant, hạn dùng, nonce) — chỉ những gì application cần. */
export interface MicrosoftProfile {
  /** Object ID trong tenant — không đổi suốt đời tài khoản, khác với email. */
  oid: string;
  /** Claim `email`, thiếu thì `preferred_username` (UPN). `null` = token không có địa chỉ nào. */
  email: string | null;
}

/**
 * Đăng nhập bằng Microsoft 365 qua Entra ID — OpenID Connect, Authorization Code + PKCE (ADR-0021).
 * Là PORT vì application không gọi HTTP và không chạm `node:crypto`.
 *
 * `state`, `nonce`, `code_verifier` do hiện thực sinh và GIỮ PHÍA BACKEND (dùng một lần, có hạn) —
 * console chỉ cầm `state` để buộc lượt đăng nhập vào đúng trình duyệt đã bắt đầu nó.
 */
export interface MicrosoftIdentity {
  /** `false` = chưa cấu hình `M365_*`: console ẩn nút, hai use case trả 503 `M365_NOT_CONFIGURED`. */
  readonly configured: boolean;
  begin(): Promise<{ authorizeUrl: string; state: string }>;
  /** Đổi `code` lấy danh tính đã kiểm. Mọi lỗi ném `DomainError` có mã `M365_*`. */
  complete(input: { code: string; state: string }): Promise<MicrosoftProfile>;
}
