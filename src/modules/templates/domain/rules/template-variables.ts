import { issue, type Issue } from '../../../../shared/kernel/index.ts';
import type { ParsedVariable, VariableSpec } from '../types/template-variable.ts';

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
const VARIABLE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const ALLOWED_PREFIXES = ['payload.', 'user.'] as const;

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
export function validateBody(body: string, schema: readonly VariableSpec[]): Issue[] {
  const issues: Issue[] = [];
  const declared = new Map(schema.map((spec) => [spec.name, spec]));

  for (const variable of parseVariables(body)) {
    if (!hasAllowedPrefix(variable.path)) {
      issues.push(
        issue(
          'VARIABLE_MISSING_SOURCE',
          `variable {{ ${variable.raw} }} has no source: it must start with "payload." or "user."`,
          variable.path,
        ),
      );
      continue;
    }
    const spec = declared.get(variable.path);
    if (!spec) {
      issues.push(
        issue(
          'VARIABLE_NOT_IN_SCHEMA',
          `variable ${variable.path} is not declared in the version schema`,
          variable.path,
        ),
      );
      continue;
    }
    if (!spec.required && !variable.hasDefault) {
      issues.push(
        issue(
          'OPTIONAL_VARIABLE_WITHOUT_DEFAULT',
          `optional variable ${variable.path} must have a "| default:" filter`,
          variable.path,
        ),
      );
    }
  }

  // Footer opt-out do HỆ THỐNG chèn (UC-006 BR-10) — template tự viết là sai.
  if (/\{\{\s*footer\s*\}\}/.test(body)) {
    issues.push(
      issue(
        'FOOTER_NOT_ALLOWED',
        'template must not contain {{ footer }}; the system appends the footer after rendering',
      ),
    );
  }
  if (/unsubscribe/i.test(body)) {
    issues.push(
      issue(
        'UNSUBSCRIBE_LINK_NOT_ALLOWED',
        'template must not contain its own unsubscribe link; the token must be signed by the system',
      ),
    );
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
