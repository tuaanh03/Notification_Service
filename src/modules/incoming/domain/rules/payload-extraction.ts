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
export function missingRequiredIssues(variables: readonly ExtractedVariable[], reported: readonly Issue[] = []): Issue[] {
  // Trường đã bị báo sai kiểu (`reported`) thì không báo thêm là "thiếu" — người gọi CÓ gửi, chỉ sai kiểu.
  const already = new Set(reported.map((i) => i.path));
  return variables
    .filter((v) => v.required && v.missing)
    .map((v) => (v.source === 'path' && v.path !== null ? v.path : v.variable.slice('payload.'.length)))
    .filter((field) => !already.has(field))
    .map((field) => issue('MISSING_VARIABLE', `field "${field}" is required but missing`, field));
}

/**
 * Tên trường đi kèm mã lỗi của một lần gọi — để nhật ký nói "Thiếu trường bắt buộc: service" thay vì chỉ
 * "Thiếu trường bắt buộc". Chỉ cho lỗi THEO TRƯỜNG (thiếu / sai kiểu — `path` khác của lỗi khác như `body`,
 * `templateId` không phải trường của body), chỉ các vi phạm CÙNG mã với mã được ghi (vi phạm đầu tiên);
 * chỉ tên trường, không giá trị. Không có -> null.
 */
export function errorFieldsOf(issues: readonly Issue[]): string[] | null {
  const code = issues[0]?.code;
  if (code === undefined || !FIELD_ERROR_CODES.has(code)) return null;
  const fields = issues
    .filter((i) => i.code === code && i.path !== undefined)
    .map((i) => (i.path!.startsWith('payload.') ? i.path!.slice('payload.'.length) : i.path!));
  const unique = [...new Set(fields)].slice(0, MAX_ERROR_FIELDS);
  return unique.length > 0 ? unique : null;
}

const FIELD_ERROR_CODES = new Set(['MISSING_VARIABLE', 'INVALID_PAYLOAD_VALUE']);

/** Trần số tên trường lưu mỗi lần gọi — nhật ký chỉ cần đủ để biết sửa chỗ nào. */
export const MAX_ERROR_FIELDS = 10;

export function assertNoIssues(issues: readonly Issue[]): void {
  if (issues.length > 0) throw new ValidationError(issues);
}
