/** Nguồn giá trị của MỘT biến template (ADR-0030 §4). */
export type VariableMapping =
  /** Lấy tại đường dẫn trong JSON; không có thì `defaultValue` (null = coi như thiếu). */
  | { variable: string; kind: 'path'; path: string; defaultValue: string | null }
  /** Chữ cố định — thông tin không có trong JSON. */
  | { variable: string; kind: 'fixed'; value: string };

/** Chỉ phát khi giá trị tại `path` (đổi ra chữ) nằm trong `values`. */
export interface PublishCondition {
  path: string;
  values: string[];
}

/** Một biến của bản template đang xuất bản. */
export interface TemplateVariable {
  /** Dạng đầy đủ, ví dụ `payload.service`. */
  name: string;
  required: boolean;
}
