import type { VariableSource } from '../../../shared/kernel/index.ts';

/**
 * Biến trong template — HAI NGUỒN, MỘT CÚ PHÁP.
 *
 *   {{ payload.order_number }}                        <- body của một lần gửi (≤ 2 KB)
 *   {{ user.tags.first_name | default: "quý khách" }} <- user_tags, app service gán
 *   {{ user.external_id }}                            <- thuộc tính hệ thống của user
 *
 * Cú pháp ngắn `{{ order_number }}` KHÔNG hợp lệ: nó trỏ tới nguồn khác hẳn và
 * sẽ render ra chuỗi rỗng — lỗi rất khó thấy khi thư đã gửi đi rồi.
 */
export interface VariableSpec {
  name: string;
  source: VariableSource;
  required: boolean;
}

const VARIABLE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const ALLOWED_PREFIXES = ['payload.', 'user.'] as const;

export interface ParsedVariable {
  /** Đường dẫn đã bỏ filter, ví dụ `user.tags.first_name`. */
  path: string;
  /** Có `| default:` phía sau hay không. */
  hasDefault: boolean;
  raw: string;
}

export function parseVariables(body: string): ParsedVariable[] {
  const found: ParsedVariable[] = [];
  for (const match of body.matchAll(VARIABLE_RE)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const [pathPart = '', ...filters] = raw.split('|').map((part) => part.trim());
    found.push({
      path: pathPart,
      hasDefault: filters.some((filter) => filter.startsWith('default:')),
      raw,
    });
  }
  return found;
}

export function hasAllowedPrefix(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Biến còn sót sau khi render -> lô failed với lý do unresolved_variables, KHÔNG gửi thư lỗi. */
export function unresolvedVariables(rendered: string): string[] {
  return parseVariables(rendered).map((variable) => variable.path);
}

/**
 * Kiểm tra lúc PUBLISH một version. Trả về danh sách lỗi; rỗng nghĩa là hợp lệ.
 * Publish có lỗi -> 422, không bao giờ để version hỏng lọt vào trạng thái published.
 */
export function validateBody(body: string, schema: readonly VariableSpec[]): string[] {
  const issues: string[] = [];
  const declared = new Map(schema.map((spec) => [spec.name, spec]));

  for (const variable of parseVariables(body)) {
    if (!hasAllowedPrefix(variable.path)) {
      issues.push(
        `biến {{ ${variable.raw} }} chưa khai nguồn: phải bắt đầu bằng "payload." hoặc "user."`,
      );
      continue;
    }
    const spec = declared.get(variable.path);
    if (!spec) {
      issues.push(`biến ${variable.path} không có trong schema của version`);
      continue;
    }
    if (!spec.required && !variable.hasDefault) {
      issues.push(`biến không bắt buộc ${variable.path} phải có filter "| default:"`);
    }
  }

  // Footer opt-out do HỆ THỐNG chèn (UC-006 BR-10) — template tự viết là sai.
  if (/\{\{\s*footer\s*\}\}/.test(body)) {
    issues.push('template không được chứa {{ footer }} — hệ thống tự nối footer sau khi render');
  }
  if (/unsubscribe/i.test(body)) {
    issues.push('template không được tự viết link unsubscribe — token phải do hệ thống ký');
  }

  return issues;
}

/** Kiểm tra lúc NHẬN GỬI: payload phải có đủ mọi biến required. */
export function missingRequiredPayloadKeys(
  payload: Record<string, unknown>,
  schema: readonly VariableSpec[],
): string[] {
  return schema
    .filter((spec) => spec.required && spec.source === 'payload')
    .map((spec) => spec.name.slice('payload.'.length))
    .filter((key) => !(key in payload));
}
