/** Một người trong tenant Microsoft 365 — chỉ những gì cần để tạo / gắn tài khoản EWS (ADR-0027). */
export interface DirectoryPerson {
  /** Object ID — cùng giá trị với claim `oid` lúc đăng nhập M365, nếu cùng tenant. */
  oid: string;
  /** Địa chỉ mail, thiếu thì UPN. Chưa chuẩn hoá. */
  email: string;
  displayName: string | null;
}

/**
 * Danh bạ tenant M365 (ADR-0027) — đọc qua Microsoft Graph bằng app `GRAPH_*` (quyền application
 * `User.Read.All`). Là PORT vì application không gọi HTTP.
 */
export interface TenantDirectory {
  /** `false` = thiếu `GRAPH_*` hoặc tenant khác app đăng nhập: use case trả 503 với mã ở `unavailableCode`. */
  readonly configured: boolean;
  readonly unavailableCode: string;
  /**
   * Mọi người ĐANG BẬT, là nhân viên (không phải khách mời), có địa chỉ email. Lỗi phía Microsoft
   * ném `UpstreamError` mã `M365_DIRECTORY_ERROR`.
   */
  listPeople(): Promise<DirectoryPerson[]>;
}
