import { ValidationError } from '../../../../shared/kernel/index.ts';

/** Một bước trong đường dẫn: tên trường hoặc chỉ số mảng (âm = đếm từ cuối). */
export type PathSegment = string | number;

export const MAX_PATH_LENGTH = 200;
export const MAX_PATH_DEPTH = 10;

const IDENT = /^[A-Za-z0-9_$@-]+/;

/**
 * Đường dẫn JSON của incoming webhook (ADR-0030). Cú pháp cố ý nhỏ:
 *   status · endpoint.name · alerts[0].labels.service · alerts[-1].summary · labels["app.kubernetes.io/name"]
 * Không ký tự đại diện, không biểu thức. Sai -> 422 WEBHOOK_PATH_INVALID (báo ngay lúc lưu hook).
 */
export function parseJsonPath(raw: string, field = 'path'): PathSegment[] {
  const fail = (why: string) => ValidationError.of('WEBHOOK_PATH_INVALID', `invalid path "${raw}": ${why}`, field);
  if (raw.length === 0) throw fail('empty');
  if (raw.length > MAX_PATH_LENGTH) throw fail(`longer than ${MAX_PATH_LENGTH} characters`);
  const segments: PathSegment[] = [];
  let rest = raw;
  let first = true;
  while (rest.length > 0) {
    if (rest.startsWith('[')) {
      const index = /^\[(-?\d{1,6})\]/.exec(rest);
      const quoted = /^\["([^"\]]+)"\]/.exec(rest);
      if (index) {
        segments.push(Number(index[1]));
        rest = rest.slice(index[0].length);
      } else if (quoted) {
        segments.push(quoted[1]!);
        rest = rest.slice(quoted[0].length);
      } else {
        throw fail('expected [number] or ["name"]');
      }
    } else {
      if (!first) {
        if (!rest.startsWith('.')) throw fail(`unexpected "${rest[0]}"`);
        rest = rest.slice(1);
      }
      const ident = IDENT.exec(rest);
      if (!ident) throw fail('expected a field name');
      segments.push(ident[0]);
      rest = rest.slice(ident[0].length);
    }
    first = false;
    if (segments.length > MAX_PATH_DEPTH) throw fail(`deeper than ${MAX_PATH_DEPTH} levels`);
  }
  return segments;
}

/** Giá trị tại đường dẫn; `undefined` = không có (thiếu trường, sai kiểu, ngoài mảng). */
export function readJsonPath(root: unknown, segments: readonly PathSegment[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment < 0 ? current.length + segment : segment];
    } else {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
      if (!Object.hasOwn(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * JSON với khoá object xếp theo thứ tự chữ — hai body cùng nội dung, khác thứ tự khoá cho cùng chuỗi.
 * Dùng để băm body khi chống trùng.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}
