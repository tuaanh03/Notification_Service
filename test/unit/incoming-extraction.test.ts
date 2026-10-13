import { describe, expect, it } from 'vitest';
import {
  conditionMet,
  dedupeValue,
  errorFieldsOf,
  extractPayload,
  missingRequiredIssues,
  parseJsonPath,
  readJsonPath,
  stableStringify,
  toTemplateValue,
  validateHookConfig,
  type VariableMapping,
} from '../../src/modules/incoming/domain/index.ts';
import { SYSTEM_SETTINGS, effectiveSettings, normalizeSetting } from '../../src/modules/settings/domain/index.ts';
import { TemplateId, TopicId } from '../../src/shared/kernel/index.ts';
import { NodeHookCrypto } from '../../src/modules/incoming/infrastructure/adapters/node-hook-crypto.ts';
import { IncomingHook } from '../../src/modules/incoming/domain/entities/incoming-hook.ts';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return (err as { issues?: { code: string }[] }).issues?.[0]?.code;
  }
  return undefined;
};

describe('parseJsonPath / readJsonPath (ADR-0030 §3)', () => {
  const body = {
    status: 'firing',
    endpoint: { name: 'api' },
    alerts: [{ labels: { 'app.kubernetes.io/name': 'payment-api' }, summary: 'CPU' }, { summary: 'Latency' }],
    'odd-key': 1,
  };

  it.each([
    ['status', ['status'], 'firing'],
    ['endpoint.name', ['endpoint', 'name'], 'api'],
    ['alerts[0].summary', ['alerts', 0, 'summary'], 'CPU'],
    ['alerts[-1].summary', ['alerts', -1, 'summary'], 'Latency'],
    ['alerts[0].labels["app.kubernetes.io/name"]', ['alerts', 0, 'labels', 'app.kubernetes.io/name'], 'payment-api'],
    ['["odd-key"]', ['odd-key'], 1],
    ['odd-key', ['odd-key'], 1],
  ])('%s', (path, segments, value) => {
    expect(parseJsonPath(path)).toEqual(segments);
    expect(readJsonPath(body, parseJsonPath(path))).toBe(value);
  });

  it('không có -> undefined (thiếu trường, sai kiểu, ngoài mảng)', () => {
    for (const path of ['nope', 'status.x', 'alerts[5].summary', 'endpoint[0]', 'alerts.summary']) {
      expect(readJsonPath(body, parseJsonPath(path))).toBeUndefined();
    }
  });

  it.each(['', 'a..b', '.a', 'a.', 'a[x]', 'a[0', 'a b', '*', `a${'.a'.repeat(10)}`, 'x'.repeat(201)])('"%s" -> WEBHOOK_PATH_INVALID', (p) =>
    expect(codeOf(() => parseJsonPath(p))).toBe('WEBHOOK_PATH_INVALID'),
  );

  it('không đi theo prototype (toString, __proto__)', () => {
    expect(readJsonPath({}, parseJsonPath('toString'))).toBeUndefined();
    expect(readJsonPath({}, parseJsonPath('__proto__'))).toBeUndefined();
  });

  it('stableStringify: khác thứ tự khoá -> cùng chuỗi', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(stableStringify({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
  });
});

describe('toTemplateValue', () => {
  it('chữ / số / bool giữ · mảng chữ-số nối ", " · null / rỗng -> thiếu · object -> lỗi', () => {
    expect(toTemplateValue('a')).toBe('a');
    expect(toTemplateValue(3)).toBe(3);
    expect(toTemplateValue(false)).toBe(false);
    expect(toTemplateValue(['prod', 'hanoi', 2])).toBe('prod, hanoi, 2');
    expect(toTemplateValue(null)).toBeUndefined();
    expect(toTemplateValue('  ')).toBeUndefined(); // Gatus điền "" cho chỗ trống không có giá trị
    expect(toTemplateValue([])).toBeUndefined();
    expect(toTemplateValue({ a: 1 })).toEqual({ invalid: true });
    expect(toTemplateValue([{ a: 1 }])).toEqual({ invalid: true });
  });
});

describe('extractPayload — ánh xạ > chữ cố định > trường cùng tên (ADR-0030 §4)', () => {
  const vars = [
    { name: 'payload.service', required: true },
    { name: 'payload.group', required: false },
    { name: 'payload.detail', required: true },
    { name: 'payload.source', required: false },
    { name: 'payload.severity', required: false },
    { name: 'payload.tags', required: false },
    { name: 'user.external_id', required: false },
  ];
  const mappings: VariableMapping[] = [
    { variable: 'payload.service', kind: 'path', path: 'endpoint.name', defaultValue: null },
    { variable: 'payload.group', kind: 'path', path: 'endpoint.group', defaultValue: 'chung' },
    { variable: 'payload.detail', kind: 'path', path: 'alert.description', defaultValue: null },
    { variable: 'payload.source', kind: 'fixed', value: 'Gatus' },
    { variable: 'payload.removed', kind: 'fixed', value: 'x' },
  ];

  it('đủ nguồn: rút đúng, mặc định khi thiếu, cùng tên ở tầng đầu, mảng nối; user.* không đụng', () => {
    const r = extractPayload(
      { endpoint: { name: 'api' }, alert: { description: 'CPU > 95%' }, severity: 'critical', tags: ['prod', 'hanoi'] },
      mappings,
      vars,
    );
    expect(r.payload).toEqual({ service: 'api', group: 'chung', detail: 'CPU > 95%', source: 'Gatus', severity: 'critical', tags: 'prod, hanoi' });
    expect(r.variables.find((v) => v.variable === 'payload.group')).toMatchObject({ source: 'path', usedDefault: true, value: 'chung' });
    expect(r.variables.find((v) => v.variable === 'payload.severity')).toMatchObject({ source: 'same_name', path: 'severity' });
    expect(r.variables.some((v) => v.variable === 'user.external_id')).toBe(false);
    expect(r.unusedMappings).toEqual(['payload.removed']);
    expect(r.issues).toEqual([]);
  });

  it('biến bắt buộc thiếu -> missing (template sẽ báo MISSING_VARIABLE); object -> INVALID_PAYLOAD_VALUE', () => {
    const r = extractPayload({ endpoint: { name: { nested: true } } }, mappings, vars);
    expect(r.variables.find((v) => v.variable === 'payload.detail')).toMatchObject({ missing: true, required: true });
    // Lỗi theo trường của body người gọi (đường dẫn đã ánh xạ), không theo `payload.*`.
    expect(r.issues).toEqual([expect.objectContaining({ code: 'INVALID_PAYLOAD_VALUE', path: 'endpoint.name' })]);
    expect(r.payload).not.toHaveProperty('service');
  });

  it('missingRequiredIssues: báo theo tên trường (cùng tên) hoặc đường dẫn đã ánh xạ', () => {
    const plain = extractPayload({}, [], [{ name: 'payload.service', required: true }, { name: 'payload.note', required: false }]);
    expect(missingRequiredIssues(plain.variables)).toEqual([
      { code: 'MISSING_VARIABLE', message: 'field "service" is required but missing', path: 'service' },
    ]);
    const mapped = extractPayload({ endpoint: {} }, mappings, vars);
    expect(missingRequiredIssues(mapped.variables).map((i) => i.path)).toContain('alert.description');
  });

  it('trường sai kiểu không bị báo thêm là "thiếu"; errorFieldsOf lấy tên trường của mã lỗi đầu tiên', () => {
    const r = extractPayload({ service: { a: 1 } }, [], [{ name: 'payload.service', required: true }, { name: 'payload.detail', required: true }]);
    const issues = [...r.issues, ...missingRequiredIssues(r.variables, r.issues)];
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['INVALID_PAYLOAD_VALUE', 'service'],
      ['MISSING_VARIABLE', 'detail'],
    ]);
    expect(errorFieldsOf(issues)).toEqual(['service']);
    expect(errorFieldsOf(missingRequiredIssues(extractPayload({}, [], [{ name: 'payload.a', required: true }, { name: 'payload.b', required: true }]).variables))).toEqual(['a', 'b']);
    // Lỗi từ template (đường /v1) mang `payload.x` — vẫn ra tên trường.
    expect(errorFieldsOf([{ code: 'MISSING_VARIABLE', message: 'm', path: 'payload.x' }])).toEqual(['x']);
    expect(errorFieldsOf([{ code: 'INCOMING_BODY_INVALID', message: 'm' }])).toBeNull();
  });

  it('body không phải object: chỉ còn chữ cố định / mặc định', () => {
    expect(extractPayload(['x'], mappings, vars).payload).toEqual({ group: 'chung', source: 'Gatus' });
  });
});

describe('điều kiện phát và khoá chống trùng', () => {
  it('conditionMet so theo dạng chữ; không có điều kiện = luôn phát', () => {
    const body = { alert: { state: 'TRIGGERED' }, code: 500 };
    expect(conditionMet(body, null)).toBe(true);
    expect(conditionMet(body, { path: 'alert.state', values: ['TRIGGERED'] })).toBe(true);
    expect(conditionMet(body, { path: 'alert.state', values: ['RESOLVED'] })).toBe(false);
    expect(conditionMet(body, { path: 'code', values: ['500'] })).toBe(true);
    expect(conditionMet(body, { path: 'missing', values: [''] })).toBe(false);
  });

  it('dedupeValue: chỉ nhận chữ / số', () => {
    expect(dedupeValue({ id: 'inc-1' }, 'id')).toBe('inc-1');
    expect(dedupeValue({ id: 7 }, 'id')).toBe('7');
    expect(dedupeValue({ id: { a: 1 } }, 'id')).toBeNull();
    expect(dedupeValue({ id: 'x' }, null)).toBeNull();
  });
});

describe('validateHookConfig — báo hết lỗi một lần', () => {
  const base = {
    name: ' Gatus ',
    topicId: TopicId.create(),
    templateId: TemplateId.create(),
    mappings: [] as VariableMapping[],
    dedupePath: null,
    condition: null,
  };

  it('chuẩn hoá khoảng trắng; dedupePath rỗng -> null', () => {
    const v = validateHookConfig({ ...base, dedupePath: '  ', condition: { path: ' a.b ', values: [' X ', 'X', ''] } });
    expect([v.name, v.dedupePath, v.condition]).toEqual(['Gatus', null, { path: 'a.b', values: ['X'] }]);
  });

  it('nhiều lỗi cùng lúc', () => {
    try {
      validateHookConfig({
        ...base,
        name: '',
        mappings: [
          { variable: 'service', kind: 'fixed', value: 'x' },
          { variable: 'payload.a', kind: 'path', path: 'a..b', defaultValue: null },
          { variable: 'payload.a', kind: 'fixed', value: 'x' },
        ],
        condition: { path: 'ok', values: [] },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as { issues: { code: string }[] }).issues.map((i) => i.code).sort()).toEqual([
        'INCOMING_CONDITION_INVALID',
        'INCOMING_HOOK_NAME_INVALID',
        'INCOMING_MAPPING_INVALID',
        'INCOMING_MAPPING_INVALID',
        'WEBHOOK_PATH_INVALID',
      ]);
    }
  });
});

describe('IncomingHook — chỗ của hook theo trần cài đặt', () => {
  it('chỗ nhỏ nhất còn trống trong 1…max; đủ max hook (kể cả khi trần vừa bị hạ) -> null', () => {
    expect(IncomingHook.freeSlot([], 20)).toBe(1);
    expect(IncomingHook.freeSlot([1, 2, 4], 20)).toBe(3);
    expect(IncomingHook.freeSlot([1, 2, 3], 3)).toBeNull();
    expect(IncomingHook.freeSlot([11, 12, 13], 3)).toBeNull();
    expect(codeOf(() => IncomingHook.assertHasFreeSlot(null, 3))).toBe('INCOMING_HOOK_LIMIT_REACHED');
  });
});

describe('Cài đặt hệ thống', () => {
  it('mặc định khi chưa lưu; giá trị lưu ngoài khoảng -> mặc định', () => {
    expect(effectiveSettings(new Map())).toEqual({
      'incoming.dedupe_window_minutes': 10,
      'incoming.max_publications_per_minute': 20,
      'api.public_base_url': null,
      'incoming.max_hooks_per_app': 20,
      'apps.max_active_api_keys': 20,
      'webhooks.max_endpoints_per_app': 10,
    });
    expect(effectiveSettings(new Map([['incoming.dedupe_window_minutes', 99999]]))['incoming.dedupe_window_minutes']).toBe(10);
  });

  it('kiểm khoảng và URL', () => {
    expect(normalizeSetting('incoming.dedupe_window_minutes', 1440)).toBe(1440);
    expect(codeOf(() => normalizeSetting('incoming.dedupe_window_minutes', 0))).toBe('SETTING_OUT_OF_RANGE');
    expect(codeOf(() => normalizeSetting('incoming.max_publications_per_minute', 2.5))).toBe('SETTING_OUT_OF_RANGE');
    expect(normalizeSetting('api.public_base_url', 'https://ews-api.example.com/')).toBe('https://ews-api.example.com');
    expect(codeOf(() => normalizeSetting('api.public_base_url', 'http://ews-api.example.com'))).toBe('SETTING_INVALID_URL');
    expect(codeOf(() => normalizeSetting('api.public_base_url', 'https://a.com/?x=1'))).toBe('SETTING_INVALID_URL');
    expect(codeOf(() => normalizeSetting('apps.max_active_api_keys', 101))).toBe('SETTING_OUT_OF_RANGE');
    expect(Object.keys(SYSTEM_SETTINGS)).toHaveLength(6);
  });
});

describe('NodeHookCrypto — token tính lại được, không lưu', () => {
  it('cùng (khoá, hook, phiên bản) -> cùng token; đổi phiên bản / khoá -> khác; khớp định dạng route', () => {
    const crypto = new NodeHookCrypto({ signingKey: 'k'.repeat(32) });
    const a = crypto.tokenFor('hook-1', 1);
    expect(a.token).toMatch(/^ewshk_[A-Za-z0-9_-]{43}$/);
    expect(crypto.tokenFor('hook-1', 1)).toEqual(a);
    expect(a.hash).toBe(crypto.sha256(a.token));
    expect(a.hint).toBe(`ewshk_${a.token.slice(6, 10)}…${a.token.slice(-4)}`);
    expect(crypto.tokenFor('hook-1', 2).token).not.toBe(a.token);
    expect(crypto.tokenFor('hook-2', 1).token).not.toBe(a.token);
    expect(new NodeHookCrypto({ signingKey: 'x'.repeat(32) }).tokenFor('hook-1', 1).token).not.toBe(a.token);
  });

  it('thiếu khoá -> configured false, không tính token', () => {
    const crypto = new NodeHookCrypto({ signingKey: undefined });
    expect(crypto.configured).toBe(false);
    expect(() => crypto.tokenFor('hook-1', 1)).toThrow();
  });
});
