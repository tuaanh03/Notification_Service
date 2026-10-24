import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mọi route của API cho dev (`/admin`, `/v1`, `/hooks`) phải khai `doc(...)` (ADR-0045) — không có thì route đó vắng
 * khỏi OpenAPI và trang Developer mà không ai biết. Kiểm tĩnh trên mã nguồn: route nào cũng là
 * `app.<method>('<path>', { config: … doc(…) … }, handler)`.
 *
 * Ngoại lệ có chủ đích: route public KHÔNG phải API cho dev — `/auth/*` (console tự gọi) và ảnh đếm "đã mở".
 */
const ROOT = join(import.meta.dirname, '..', '..', 'src', 'modules');
const NOT_DEV_API = new Set(['tenancy/interface/http/auth.routes.ts', 'notifications/interface/http/public-tracking.routes.ts']);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return full.includes(`${join('interface', 'http')}`) && name.endsWith('.routes.ts') ? [full] : [];
  });
}

describe('OpenAPI: mọi route API khai doc()', () => {
  const files = routeFiles(ROOT).filter((f) => !NOT_DEV_API.has(relative(ROOT, f)));

  it('tìm thấy file route', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('không route nào thiếu doc()', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const call = /\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
      for (let m = call.exec(source); m !== null; m = call.exec(source)) {
        // Phần options nằm giữa path và handler `async (`.
        const rest = source.slice(m.index + m[0].length);
        const options = rest.slice(0, Math.max(0, rest.indexOf('async (')));
        if (!/\bdoc\(/.test(options)) missing.push(`${relative(ROOT, file)}: ${m[1]!.toUpperCase()} ${m[2]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
