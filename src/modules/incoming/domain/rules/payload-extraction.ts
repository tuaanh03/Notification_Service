import { issue, ValidationError, type Issue } from '../../../../shared/kernel/index.ts';
import type { PublishCondition, TemplateVariable, VariableMapping } from '../types/hook-config.ts';
import { parseJsonPath, readJsonPath } from './json-path.ts';

/** Một biến đã rút — để xem trước trên console và để báo đúng chỗ khi thiếu. */
export interface ExtractedVariable {
  variable: string;
  required: boolean;
  /** path = theo ánh xạ · fixed = chữ cố định · same_name = trường cùng tên ở tầng đầu · none = không có nguồn */
  source: 'path' | 'fixed' | 'same_name' | 'none';
  path: string | null;
  value: string | number | boolean | null;
  usedDefault: boolean;
  /** Không có giá trị (biến bắt buộc thiếu -> template báo MISSING_VARIABLE). */
  missing: boolean;
}

export interface ExtractionResult {
  /** Khoá không có tiền tố `payload.` — đúng dạng `payload` mà template nhận. */
  payload: Record<string, string | number | boolean>;
  variables: ExtractedVariable[];
  /** Ánh xạ cho biến mà bản template hiện tại không khai — bị bỏ qua, chỉ để console cảnh báo. */
  unusedMappings: string[];
  /** Giá trị không dùng được (object, mảng chứa object…) — có thì KHÔNG phát. */
  issues: Issue[];
}

type Scalar = string | number | boolean;

/**
 * Đổi giá trị JSON thành giá trị đổ vào template:
 *   chữ / số / true-false -> giữ · mảng toàn chữ-số -> nối ", " · null / thiếu -> undefined · còn lại -> lỗi.
 * Chuỗi rỗng (hoặc toàn khoảng trắng) cũng là "không có": Gatus điền `""` cho chỗ trống không có giá trị
 * (`[ENDPOINT_GROUP]` khi endpoint không thuộc nhóm) — coi là có thì giá trị mặc định không bao giờ được dùng.
 */
export function toTemplateValue(value: unknown): Scalar | undefined | { invalid: true } {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
    return value.length === 0 ? undefined : value.join(', ');
  }
  return { invalid: true };
}

const isInvalid = (v: ReturnType<typeof toTemplateValue>): v is { invalid: true } => typeof v === 'object' && v !== null;

/**
 * Rút `payload` cho template từ JSON công cụ ngoài gửi tới (ADR-0030 §4). Với MỖI biến `payload.*` của
 * bản đang xuất bản: ánh xạ đường dẫn (kèm mặc định) > chữ cố định > trường cùng tên ở tầng đầu.
 * Biến `user.*` do EWS tự đổ, không rút ở đây. Không ném lỗi — trả `issues` để nơi gọi quyết định.
 */
export function extractPayload(
  body: unknown,
  mappings: readonly VariableMapping[],
  templateVariables: readonly TemplateVariable[],
): ExtractionResult {
  const byVariable = new Map(mappings.map((m) => [m.variable, m]));
  const payload: Record<string, Scalar> = {};
  const variables: ExtractedVariable[] = [];
  const issues: Issue[] = [];

  for (const tv of templateVariables.filter((v) => v.name.startsWith('payload.'))) {
    const key = tv.name.slice('payload.'.length);
    const mapping = byVariable.get(tv.name);
    let source: ExtractedVariable['source'] = 'none';
    let path: string | null = null;
    let raw: unknown;
    let usedDefault = false;

    if (mapping?.kind === 'fixed') {
      source = 'fixed';
      raw = mapping.value;
    } else if (mapping?.kind === 'path') {
      source = 'path';
      path = mapping.path;
      raw = readJsonPath(body, parseJsonPath(mapping.path));
    } else if (body !== null && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, key)) {
      source = 'same_name';
      path = key;
      raw = (body as Record<string, unknown>)[key];
    }

    let value = toTemplateValue(raw);
    if (isInvalid(value)) {
      issues.push(issue('INVALID_PAYLOAD_VALUE', `field "${path ?? key}" must be text or a number, not an object`, path ?? key));
      value = undefined;
    } else if (value === undefined && mapping?.kind === 'path' && mapping.defaultValue !== null) {
      value = mapping.defaultValue;
      usedDefault = true;
    }
    if (value !== undefined) payload[key] = value;
    variables.push({
      variable: tv.name,
      required: tv.required,
      source,
      path,
      value: value ?? null,
      usedDefault,
      missing: value === undefined,
    });
  }

  const declared = new Set(templateVariables.map((v) => v.name));
  return { payload, variables, unusedMappings: mappings.map((m) => m.variable).filter((v) => !declared.has(v)), issues };
}

/** Điều kiện phát: không có điều kiện = luôn phát. So theo dạng chữ của giá trị. */
export function conditionMet(body: unknown, condition: PublishCondition | null): boolean {
  if (condition === null) return true;
  const value = toTemplateValue(readJsonPath(body, parseJsonPath(condition.path)));
  if (value === undefined || isInvalid(value)) return false;
  return condition.values.includes(String(value));
}

/** Giá trị chống trùng tại đường dẫn; null = không có / không phải chữ-số. */
export function dedupeValue(body: unknown, path: string | null): string | null {
  if (path === null) return null;
  const value = readJsonPath(body, parseJsonPath(path));
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/**
 * Biến bắt buộc không có giá trị — báo theo TÊN TRƯỜNG người gọi gửi (`service`, hoặc đường dẫn đã ánh xạ
 * `endpoint.name`), không theo `payload.service` của template: người cấu hình công cụ gọi vào chỉ thấy body
 * của mình. Cùng mã `MISSING_VARIABLE` với `/v1` — nhật ký và console không phải đổi.
 */
export function missingRequiredIssues(variables: readonly ExtractedVariable[]): Issue[] {
  return variables
    .filter((v) => v.required && v.missing)
    .map((v) => {
      const field = v.source === 'path' && v.path !== null ? v.path : v.variable.slice('payload.'.length);
      return issue('MISSING_VARIABLE', `field "${field}" is required but missing`, field);
    });
}

export function assertNoIssues(issues: readonly Issue[]): void {
  if (issues.length > 0) throw new ValidationError(issues);
}
