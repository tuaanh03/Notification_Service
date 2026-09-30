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

/**
 * Biến `user.*` đã có dữ liệu để đổ lúc gửi. `user.tags.*` CHƯA: app chưa có đường ghi tag
 * (plan §12), để lọt qua publish thì thư gửi đi sẽ trống đúng chỗ đó — chặn ngay từ publish.
 */
export const SUPPORTED_USER_VARIABLES: readonly string[] = ['user.external_id'];

/** `payload.<key>` một cấp — `missingRequiredPayloadKeys` tra `key in payload`, không đi sâu vào object. */
const PAYLOAD_VARIABLE_RE = /^payload\.[A-Za-z_][A-Za-z0-9_]*$/;

/** Kiểm tra lúc PUBLISH: chính danh sách biến khai trong schema. */
export function validateSchema(schema: readonly VariableSpec[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const spec of schema) {
    if (seen.has(spec.name)) {
      issues.push(issue('DUPLICATE_VARIABLE', `variable ${spec.name} is declared more than once`, spec.name));
      continue;
    }
    seen.add(spec.name);
    if (!spec.name.startsWith(`${spec.source}.`)) {
      issues.push(
        issue('VARIABLE_SOURCE_MISMATCH', `variable ${spec.name} must start with "${spec.source}."`, spec.name),
      );
    } else if (spec.source === 'payload' && !PAYLOAD_VARIABLE_RE.test(spec.name)) {
      issues.push(
        issue(
          'INVALID_VARIABLE_NAME',
          `variable ${spec.name} must be payload.<key> with letters, digits and _ only`,
          spec.name,
        ),
      );
    } else if (spec.source === 'user' && !SUPPORTED_USER_VARIABLES.includes(spec.name)) {
      issues.push(unsupportedUserVariable(spec.name));
    }
  }
  return issues;
}

/** Kiểm tra lúc PUBLISH: biến `user.*` dùng trong nội dung phải là loại đã đổ được. */
export function validateSupportedVariables(body: string): Issue[] {
  return parseVariables(body)
    .filter((v) => v.path.startsWith('user.') && !SUPPORTED_USER_VARIABLES.includes(v.path))
    .map((v) => unsupportedUserVariable(v.path));
}

function unsupportedUserVariable(path: string): Issue {
  return issue(
    'USER_VARIABLE_NOT_SUPPORTED',
    `variable ${path} is not supported yet; supported user variables: ${SUPPORTED_USER_VARIABLES.join(', ')}`,
    path,
  );
}

const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const ALLOWED_LINK_RE = /^(https:\/\/|mailto:)/i;
/** Link bắt đầu bằng biến (`{{ payload.action_url }}`): chưa biết giá trị — kiểm lại sau khi đổ biến lúc gửi. */
const VARIABLE_LINK_RE = /^\{\{/;

/**
 * Kiểm tra lúc PUBLISH: link trong thư chỉ được `https://` hoặc `mailto:`.
 * `javascript:`, `data:`, `http://` và link tương đối (vô nghĩa trong hộp thư) đều bị chặn.
 */
export function validateLinks(html: string): Issue[] {
  const issues: Issue[] = [];
  for (const match of html.matchAll(HREF_RE)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (ALLOWED_LINK_RE.test(value) || VARIABLE_LINK_RE.test(value)) continue;
    issues.push(
      issue('LINK_SCHEME_NOT_ALLOWED', `link "${value}" is not allowed: only https:// and mailto: links are accepted`, 'html'),
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
