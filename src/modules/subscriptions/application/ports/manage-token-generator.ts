/**
 * Sinh `manage_token` — token trong link "Quản lý thông báo", thay cho user_id/person_id. Phải KHÔNG
 * đoán được; cột lưu dạng UUID (CHAR 36). Port vì là quyết định mật mã, hạ tầng hiện thực.
 */
export interface ManageTokenGenerator {
  next(): string;
}
