/**
 * Con số do Super Admin chỉnh ở Cài đặt hệ thống (module settings) mà apps cần. Adapter gọi query
 * công khai của settings, KHÔNG query bảng `system_settings`.
 */
export interface AppLimits {
  maxActiveApiKeys(): Promise<number>;
}
