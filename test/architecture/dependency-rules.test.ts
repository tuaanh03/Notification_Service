import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LUẬT KIẾN TRÚC — ép bằng test thay vì dựa vào kỷ luật người viết.
 *
 * Viết tay thay vì dependency-cruiser: repo dùng TypeScript 7 (bản native), không còn JS API
 * cho công cụ phân tích bên ngoài. Parser ở đây chỉ đọc câu `import/export ... from '...'`,
 * đủ cho quy ước của repo (không dùng require, không import động trong src).
 *
 * Mỗi luật in ra ĐÚNG các cạnh vi phạm, để người sửa biết phải sửa chỗ nào.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');

interface SourceFile {
  path: string; // tương đối từ ROOT, dùng '/'
  text: string;
  internal: string[]; // import tương đối đã resolve, tương đối từ ROOT
  external: string[]; // tên package
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

const files: SourceFile[] = walk(SRC).map((full) => {
  const text = readFileSync(full, 'utf8');
  const specs = [...text.matchAll(IMPORT_RE), ...text.matchAll(SIDE_EFFECT_RE)].map((m) => m[1]!);
  return {
    path: rel(full),
    text,
    internal: specs.filter((s) => s.startsWith('.')).map((s) => rel(resolve(dirname(full), s))),
    external: specs.filter((s) => !s.startsWith('.')),
  };
});

// --- phân loại ---------------------------------------------------------------
const seg = (p: string) => p.split('/');
/** Tên module với file nằm TRONG một module; barrel tổng `src/modules/index.ts` không thuộc module nào. */
const moduleOf = (p: string) => (seg(p)[1] === 'modules' && seg(p).length > 3 ? seg(p)[2] : undefined);
/** domain | application | infrastructure | interface — với file trong modules/. */
const layerOf = (p: string) => (seg(p)[1] === 'modules' ? seg(p)[3] : undefined);
const isDomain = (p: string) => layerOf(p) === 'domain';
const isApplication = (p: string) =>
  layerOf(p) === 'application' || p.startsWith('src/shared/application/');
const isKernel = (p: string) => p.startsWith('src/shared/kernel/');
const isSchema = (p: string) => /^src\/modules\/[^/]+\/infrastructure\/db\/schema\.ts$/.test(p);
const isEntrypoint = (p: string) => p === 'src/index.ts' || p.startsWith('src/entrypoints/');

type Edge = `${string} -> ${string}`;
function violations(check: (from: SourceFile, to: string) => boolean): Edge[] {
  return files.flatMap((f) => f.internal.filter((to) => check(f, to)).map((to): Edge => `${f.path} -> ${to}`));
}
function externalViolations(check: (from: SourceFile, pkg: string) => boolean): Edge[] {
  return files.flatMap((f) => f.external.filter((pkg) => check(f, pkg)).map((pkg): Edge => `${f.path} -> ${pkg}`));
}

/** ADR-0010: hai import xuyên module DUY NHẤT được phép ở tầng domain. */
const ADR_0010: ReadonlySet<Edge> = new Set<Edge>([
  'src/modules/segments/domain/rules/resolution-pipeline.ts -> src/modules/subscriptions/domain/rules/subscription-gate.ts',
  'src/modules/segments/domain/rules/resolution-pipeline.ts -> src/modules/topics/domain/rules/topic-consent.ts',
]);

describe('luật phụ thuộc', () => {
  it('parser thấy được mã nguồn (chặn trường hợp test pass vì đọc rỗng)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.internal.length > 0)).toBe(true);
  });

  it('domain chỉ import shared/kernel và domain của chính module (+ ngoại lệ ADR-0010)', () => {
    const bad = violations((f, to) => {
      if (!isDomain(f.path)) return false;
      const sameModuleDomain = moduleOf(to) === moduleOf(f.path) && layerOf(to) === 'domain';
      return !isKernel(to) && !sameModuleDomain && !ADR_0010.has(`${f.path} -> ${to}`);
    });
    expect(bad).toEqual([]);
  });

  it('domain và kernel không import package ngoài (trừ node:crypto cho sinh id)', () => {
    const bad = externalViolations(
      (f, pkg) => (isDomain(f.path) || isKernel(f.path)) && !(isKernel(f.path) && pkg === 'node:crypto'),
    );
    expect(bad).toEqual([]);
  });

  it('kernel không import gì ngoài kernel', () => {
    expect(violations((f, to) => isKernel(f.path) && !isKernel(to))).toEqual([]);
  });

  it('application chỉ biết domain, kernel và port — không biết hạ tầng', () => {
    const allowed = (from: string, to: string) =>
      isKernel(to) ||
      to.startsWith('src/shared/application/') ||
      to === 'src/shared/observability/logger.ts' ||
      (moduleOf(to) !== undefined &&
        moduleOf(to) === moduleOf(from) &&
        (layerOf(to) === 'domain' || layerOf(to) === 'application'));
    expect(violations((f, to) => isApplication(f.path) && !allowed(f.path, to))).toEqual([]);
    expect(externalViolations((f) => isApplication(f.path))).toEqual([]);
  });

  it('xuyên module ở infrastructure chỉ được schema.ts -> schema.ts (khai FK), không query bảng module khác', () => {
    const bad = violations((f, to) => {
      const other = moduleOf(to) !== undefined && moduleOf(to) !== moduleOf(f.path);
      if (!other || layerOf(f.path) === 'domain') return false; // domain đã có luật riêng
      if (layerOf(to) === 'infrastructure') return !(isSchema(f.path) && isSchema(to));
      // Module A cần B thì adapter của A gọi application của B (port) — không đụng domain/interface của B.
      return !(layerOf(f.path) === 'infrastructure' && layerOf(to) === 'application');
    });
    expect(bad).toEqual([]);
  });

  it('shared không phụ thuộc vào module nghiệp vụ', () => {
    expect(
      violations((f, to) => f.path.startsWith('src/shared/') && to.startsWith('src/modules/')),
    ).toEqual([]);
  });

  it('chỉ entrypoint được import composition root', () => {
    expect(
      violations(
        (f, to) => to.startsWith('src/composition/') && !isEntrypoint(f.path) && !f.path.startsWith('src/composition/'),
      ),
    ).toEqual([]);
  });

  it('hiện thực pino chỉ được dựng ở composition root — mọi nơi khác dùng port Logger', () => {
    expect(
      violations(
        (f, to) =>
          to === 'src/shared/observability/pino-logger.ts' &&
          !f.path.startsWith('src/composition/') &&
          !f.path.startsWith('src/shared/observability/'),
      ),
    ).toEqual([]);
  });

  it('mỗi package hạ tầng chỉ được import ở đúng chỗ của nó', () => {
    // pkg -> các tiền tố đường dẫn được phép. Thêm chỗ dùng mới = sửa bảng này, có chủ đích.
    const HOME: Record<string, readonly string[]> = {
      ioredis: ['src/shared/streams/'],
      'drizzle-orm': ['src/shared/db/', 'src/shared/streams/outbox-relay.ts', 'src/modules/', 'src/entrypoints/migrate.ts'],
      mysql2: ['src/shared/db/'],
      pino: ['src/shared/observability/pino-logger.ts'],
      fastify: ['src/shared/http/', 'src/modules/'],
      zod: ['src/shared/config/'],
    };
    const root = (pkg: string) => pkg.split('/')[0]!; // 'drizzle-orm/mysql-core' -> 'drizzle-orm'
    const bad = externalViolations((f, pkg) => {
      const allowed = HOME[root(pkg)];
      if (!allowed) return false;
      if (!allowed.some((prefix) => f.path.startsWith(prefix))) return true;
      // Trong modules/: HTTP chỉ ở tầng interface (route), không lọt vào infrastructure.
      // (domain/application đã bị luật riêng cấm mọi package ngoài.)
      return root(pkg) === 'fastify' && moduleOf(f.path) !== undefined && layerOf(f.path) !== 'interface';
    });
    expect(bad).toEqual([]);
  });

  it('module chỉ chạm hạ tầng dùng chung qua đúng cửa', () => {
    const bad = violations((f, to) => {
      if (moduleOf(f.path) === undefined) return false;
      // shared/db: chỉ infrastructure của module (adapter, schema).
      if (to.startsWith('src/shared/db/')) return layerOf(f.path) !== 'infrastructure';
      // shared/streams: handler (interface) chỉ thấy hợp đồng message, không thấy client Redis.
      if (to.startsWith('src/shared/streams/')) return to !== 'src/shared/streams/contracts.ts';
      return false;
    });
    expect(bad).toEqual([]);
  });

  it('không có vòng phụ thuộc giữa các file', () => {
    const graph = new Map(files.map((f) => [f.path, f.internal.filter((to) => to.startsWith('src/'))]));
    const cycles: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    const visit = (node: string): void => {
      state.set(node, 'visiting');
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        if (state.get(next) === 'visiting') cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
        else if (!state.has(next)) visit(next);
      }
      stack.pop();
      state.set(node, 'done');
    };
    for (const node of graph.keys()) if (!state.has(node)) visit(node);
    expect(cycles).toEqual([]);
  });
});

describe('phụ thuộc ẩn trong domain', () => {
  const pure = files.filter(
    (f) => (isDomain(f.path) || isKernel(f.path)) && f.path !== 'src/shared/kernel/clock.ts',
  );
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('không tự lấy giờ hệ thống — thời gian đi vào qua tham số (Clock ở application)', () => {
    const bad = pure.filter((f) => /new Date\(\)|Date\.now\(\)/.test(code(f.text))).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it('không dùng global của Node (Buffer, process) — domain không phụ thuộc runtime', () => {
    const bad = pure.filter((f) => /\bBuffer\.|\bprocess\./.test(code(f.text))).map((f) => f.path);
    expect(bad).toEqual([]);
  });
});
