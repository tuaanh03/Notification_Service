import type { VariableSource } from '../../../../shared/kernel/index.ts';

/** Khai báo một biến trong schema của template version. */
export interface VariableSpec {
  name: string;
  source: VariableSource;
  required: boolean;
}

/** Một biến `{{ ... }}` tìm thấy trong nội dung template. */
export interface ParsedVariable {
  /** Đường dẫn đã bỏ filter, ví dụ `user.tags.first_name`. */
  path: string;
  /** Có `| default:` phía sau hay không. */
  hasDefault: boolean;
  raw: string;
}
