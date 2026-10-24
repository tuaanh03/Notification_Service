import { describe, expect, it } from 'vitest';
import {
  conditionMet,
  extractPayload,
  findIntegration,
  INCOMING_INTEGRATION_IDS,
  INCOMING_INTEGRATIONS,
  integrationCondition,
  integrationMappings,
  integrationSetupBody,
  parseJsonPath,
  requireIntegration,
  validateHookConfig,
  type IncomingIntegration,
  type TemplateVariable,
} from '../../src/modules/incoming/domain/index.ts';
import {
  describeHooks,
  IncomingIntegrationQueries,
  resolveHookConfig,
  type TemplateCatalog,
  type TemplateInfo,
} from '../../src/modules/incoming/application/index.ts';
import { IncomingHook } from '../../src/modules/incoming/domain/entities/incoming-hook.ts';
import { findPreset } from '../../src/modules/templates/domain/presets/index.ts';
import { AppId, IncomingHookId, TemplateId, TopicId } from '../../src/shared/kernel/index.ts';

const issueOf = (fn: () => unknown): { code: string; path?: string } | undefined => {
  try {
    fn();
  } catch (err) {
    return (err as { issues?: { code: string; path?: string }[] }).issues?.[0];
  }
  return undefined;
};

const integration = (id: string): IncomingIntegration => findIntegration(id)!;

/** Biến của hai template alert dựng sẵn (ADR-0035) — khoá của danh mục phải là đúng các tên này. */
const presetVariables = (id: 'incident-alert' | 'incident-resolved'): (TemplateVariable & { sample: string })[] =>
  findPreset(id)!.locales.vi.schema.map((v) => ({ name: v.name, required: v.required, sample: v.sample ?? '' }));
const ALERT_VARS = presetVariables('incident-alert');
const RESOLVED_VARS = presetVariables('incident-resolved');
const PRESET_KEYS = new Set([...ALERT_VARS, ...RESOLVED_VARS].map((v) => v.name.slice('payload.'.length)));

/** Thay token của công cụ `custom` bằng giá trị thật — giả lập Datadog / Gatus / Uptime Kuma dựng body. */
const renderBody = (body: Record<string, string>, values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(body).map(([k, v]) => [k, values[v] ?? v]));

/** Body Grafana unified alerting (rút gọn từ ví dụ trong tài liệu webhook-notifier). */
const grafanaBody = (status: 'firing' | 'resolved') => ({
  receiver: 'ews',
  status,
  orgId: 1,
  alerts: [
    {
      status,
      labels: { alertname: 'High CPU', severity: 'critical', instance: 'web-01' },
      annotations: { summary: 'CPU above 95% for 5 minutes' },
      startsAt: '2026-10-23T08:30:00Z',
      endsAt: status === 'resolved' ? '2026-10-23T09:15:00Z' : '0001-01-01T00:00:00Z',
      generatorURL: 'https://grafana.example.com/alerting/grafana/abc/view',
      fingerprint: 'c6eadffa33fcdf37',
      silenceURL: 'https://grafana.example.com/alerting/silence/new',
      values: { B: 96.2 },
    },
  ],
  groupLabels: { alertname: 'High CPU' },
  commonLabels: { alertname: 'High CPU', severity: 'critical' },
  commonAnnotations: { summary: 'CPU above 95% for 5 minutes' },
  externalURL: 'https://grafana.example.com/',
  version: '1',
  groupKey: '{}:{alertname="High CPU"}',
  truncatedAlerts: 0,
  title: '[FIRING:1] High CPU',
  state: status === 'firing' ? 'alerting' : 'ok',
  message: '**Firing**',
});

describe('danh mục công cụ (ADR-0046)', () => {
  it('đủ 6 công cụ, đúng thứ tự, DTO không lộ fallbacks', () => {
    expect(INCOMING_INTEGRATIONS.map((i) => i.id)).toEqual([...INCOMING_INTEGRATION_IDS]);
    expect(INCOMING_INTEGRATION_IDS).toEqual(['generic', 'datadog', 'grafana', 'alertmanager', 'gatus', 'uptime-kuma']);
    const dto = new IncomingIntegrationQueries().list().integrations;
    expect(dto).toHaveLength(6);
    for (const d of dto) expect(Object.keys(d).sort()).toEqual(['docsUrl', 'fields', 'id', 'name', 'payload', 'status', 'steps']);
    expect(dto.find((d) => d.id === 'grafana')!.status).toEqual({ field: 'status', source: 'status', firing: ['firing'], resolved: ['resolved'] });
  });

  it('khoá là biến của template alert dựng sẵn; đường dẫn `fixed` đúng cú pháp; mỗi biến tối đa một lần', () => {
    expect(PRESET_KEYS).toEqual(new Set(['incident_title', 'severity', 'started_at', 'detail_url', 'resolved_at', 'summary']));
    for (const i of INCOMING_INTEGRATIONS) {
      const vars = i.fields.map((f) => f.variable);
      expect(new Set(vars).size, i.id).toBe(vars.length);
      for (const v of vars) expect(PRESET_KEYS.has(v), `${i.id}.${v}`).toBe(true);
      for (const v of Object.keys(i.fallbacks ?? {})) expect(vars, `${i.id} fallback ${v}`).toContain(v);
      if (i.payload === 'fixed') {
        for (const f of i.fields) expect(() => parseJsonPath(f.source), `${i.id}.${f.variable}`).not.toThrow();
        expect(() => parseJsonPath(i.status!.source)).not.toThrow();
        expect(i.status!.field).toBe(i.status!.source);
      }
      if (i.payload === 'generic') expect([i.fields.length, i.status]).toEqual([0, null]);
      else expect(i.status, i.id).not.toBeNull();
      expect(i.docsUrl === null || i.docsUrl.startsWith('https://'), i.id).toBe(true);
    }
  });

  it('các bước: vi / en cùng số bước, mỗi bước 1–70 ký tự', () => {
    for (const i of INCOMING_INTEGRATIONS) {
      expect(i.steps.vi.length, i.id).toBeGreaterThan(0);
      expect(i.steps.vi.length, i.id).toBe(i.steps.en.length);
      for (const step of [...i.steps.vi, ...i.steps.en]) {
        expect(step.trim().length, `${i.id}: ${step}`).toBeGreaterThan(0);
        expect(step.length, `${i.id}: ${step}`).toBeLessThanOrEqual(70);
      }
    }
  });

  it('token đúng của từng công cụ', () => {
    const tokens = (id: string) => Object.fromEntries(integration(id).fields.map((f) => [f.variable, f.source]));
    expect(tokens('datadog')).toMatchObject({ incident_title: '$EVENT_TITLE', detail_url: '$LINK', started_at: '$DATE' });
    expect(integration('datadog').status).toMatchObject({ source: '$ALERT_TRANSITION', firing: ['Triggered', 'Re-Triggered'], resolved: ['Recovered'] });
    expect(tokens('gatus')).toMatchObject({ incident_title: '[ENDPOINT_NAME]', summary: '[ALERT_DESCRIPTION]' });
    expect(integration('gatus').status).toMatchObject({ source: '[ALERT_TRIGGERED_OR_RESOLVED]', firing: ['TRIGGERED'], resolved: ['RESOLVED'] });
    expect(tokens('uptime-kuma')).toMatchObject({ incident_title: "{{ monitorJSON['name'] }}" });
    expect(integration('uptime-kuma').status).toMatchObject({ source: "{{ heartbeatJSON['status'] }}", firing: ['0'], resolved: ['1'] });
  });

  it('công cụ lạ -> INTEGRATION_UNKNOWN ở config.integration (cả lúc dựng lẫn lúc kiểm cấu hình)', () => {
    expect(issueOf(() => requireIntegration('pagerduty'))).toEqual(expect.objectContaining({ code: 'INTEGRATION_UNKNOWN', path: 'config.integration' }));
    const base = { name: 'x', topicId: TopicId.create(), templateId: TemplateId.create(), mappings: [], dedupePath: null, condition: null };
    expect(issueOf(() => validateHookConfig({ ...base, integration: 'nope' as never }))?.code).toBe('INTEGRATION_UNKNOWN');
    expect(validateHookConfig(base)).toMatchObject({ integration: null, trigger: null });
  });
});

describe('dựng ánh xạ + điều kiện từ công cụ', () => {
  it('generic: không ánh xạ, không điều kiện, không body mẫu', () => {
    expect(integrationMappings(integration('generic'), ALERT_VARS)).toEqual([]);
    expect(integrationCondition(integration('generic'), 'firing')).toBeNull();
    expect(integrationSetupBody(integration('generic'), ALERT_VARS)).toBeNull();
  });

  it('Grafana: danh mục ∩ biến template; firing -> chỉ firing; đổ đúng giá trị', () => {
    const grafana = integration('grafana');
    const mappings = integrationMappings(grafana, ALERT_VARS);
    expect(mappings.map((m) => m.variable)).toEqual(['payload.incident_title', 'payload.severity', 'payload.started_at', 'payload.detail_url']);
    expect(mappings[1]).toEqual({ variable: 'payload.severity', kind: 'path', path: 'alerts[0].labels.severity', defaultValue: '—' });
    const condition = integrationCondition(grafana, 'firing');
    expect(condition).toEqual({ path: 'status', values: ['firing'] });
    expect(conditionMet(grafanaBody('firing'), condition)).toBe(true);
    expect(conditionMet(grafanaBody('resolved'), condition)).toBe(false);
    const out = extractPayload(grafanaBody('firing'), mappings, ALERT_VARS);
    expect(out.issues).toEqual([]);
    expect(out.payload).toEqual({
      incident_title: 'High CPU',
      severity: 'critical',
      started_at: '2026-10-23T08:30:00Z',
      detail_url: 'https://grafana.example.com/alerting/grafana/abc/view',
    });
    expect(integrationSetupBody(grafana, ALERT_VARS)).toBeNull();
  });

  it('Alertmanager: resolved -> đổ endsAt + summary; thiếu nhãn severity -> giá trị dự phòng', () => {
    const am = integration('alertmanager');
    const body = grafanaBody('resolved');
    delete (body.alerts[0]!.labels as Record<string, string>)['severity'];
    expect(conditionMet(body, integrationCondition(am, 'resolved'))).toBe(true);
    const vars = [...RESOLVED_VARS, { name: 'payload.severity', required: true, sample: 'x' }];
    const out = extractPayload(body, integrationMappings(am, vars), vars);
    expect(out.payload).toMatchObject({ resolved_at: '2026-10-23T09:15:00Z', summary: 'CPU above 95% for 5 minutes', severity: '—' });
    expect(out.variables.filter((v) => v.missing)).toEqual([]);
  });

  it('trigger: all (hoặc thiếu) = lỗi HOẶC khắc phục — các chuyển khác (Warn, No Data) bị bỏ qua', () => {
    const datadog = integration('datadog');
    const all = integrationCondition(datadog, null);
    expect(all).toEqual({ path: 'alert_status', values: ['Triggered', 'Re-Triggered', 'Recovered'] });
    expect(integrationCondition(datadog, 'all')).toEqual(all);
    expect(conditionMet({ alert_status: 'Warn' }, all)).toBe(false);
    expect(conditionMet({ alert_status: 'Recovered' }, integrationCondition(datadog, 'resolved'))).toBe(true);
    expect(conditionMet({ alert_status: 'Recovered' }, integrationCondition(datadog, 'firing'))).toBe(false);
  });

  it('Datadog: body mẫu = token cho biến có trong danh mục + trường trạng thái; dán vào là đổ đủ', () => {
    const datadog = integration('datadog');
    const body = integrationSetupBody(datadog, ALERT_VARS)!;
    expect(body).toEqual({
      incident_title: '$EVENT_TITLE',
      severity: '$ALERT_TYPE',
      started_at: '$DATE',
      detail_url: '$LINK',
      alert_status: '$ALERT_TRANSITION',
    });
    const sent = renderBody(body, {
      $EVENT_TITLE: '[Triggered] High CPU',
      $ALERT_TYPE: 'error',
      $DATE: '1792571400000',
      $LINK: 'https://app.datadoghq.com/event/jump_to?event_id=1',
      $ALERT_TRANSITION: 'Triggered',
    });
    expect(conditionMet(sent, integrationCondition(datadog, 'firing'))).toBe(true);
    const out = extractPayload(sent, integrationMappings(datadog, ALERT_VARS), ALERT_VARS);
    expect(out.payload).toEqual({
      incident_title: '[Triggered] High CPU',
      severity: 'error',
      started_at: '1792571400000',
      detail_url: 'https://app.datadoghq.com/event/jump_to?event_id=1',
    });
  });

  it('Gatus: biến không có token -> giá trị mẫu của biến; mô tả rỗng -> dự phòng', () => {
    const gatus = integration('gatus');
    const body = integrationSetupBody(gatus, [...ALERT_VARS, { name: 'user.external_id', sample: 'x' }, { name: 'payload.summary', sample: 'tóm tắt' }])!;
    expect(body).toEqual({
      incident_title: '[ENDPOINT_NAME]',
      severity: 'Nghiêm trọng',
      started_at: '19/10/2026 08:30',
      detail_url: '[ENDPOINT_URL]',
      summary: '[ALERT_DESCRIPTION]',
      alert_status: '[ALERT_TRIGGERED_OR_RESOLVED]',
    });
    const sent = renderBody(body, { '[ENDPOINT_NAME]': 'website', '[ENDPOINT_URL]': 'https://twin.sh/health', '[ALERT_DESCRIPTION]': '', '[ALERT_TRIGGERED_OR_RESOLVED]': 'RESOLVED' });
    expect(conditionMet(sent, integrationCondition(gatus, 'resolved'))).toBe(true);
    const out = extractPayload(sent, integrationMappings(gatus, RESOLVED_VARS), RESOLVED_VARS);
    expect(out.payload).toMatchObject({ incident_title: 'website', summary: '—' });
  });

  it('Uptime Kuma: trạng thái 0 = lỗi, 1 = đã khắc phục — chữ hay số đều khớp; lần "Test" (không heartbeat) bị bỏ qua', () => {
    const kuma = integration('uptime-kuma');
    expect(integrationSetupBody(kuma, RESOLVED_VARS)).toEqual({
      incident_title: "{{ monitorJSON['name'] }}",
      resolved_at: "{{ heartbeatJSON['localDateTime'] }}",
      summary: "{{ heartbeatJSON['msg'] }}",
      alert_status: "{{ heartbeatJSON['status'] }}",
    });
    const firing = integrationCondition(kuma, 'firing');
    expect(conditionMet({ alert_status: '0' }, firing)).toBe(true);
    expect(conditionMet({ alert_status: 0 }, firing)).toBe(true);
    expect(conditionMet({ alert_status: '1' }, firing)).toBe(false);
    expect(conditionMet({ alert_status: '' }, integrationCondition(kuma, 'all'))).toBe(false);
  });

  it('trạng thái trùng tên biến -> trường trạng thái thắng (điều kiện phát cần nó)', () => {
    const body = integrationSetupBody(integration('datadog'), [{ name: 'payload.alert_status', sample: 'x' }]);
    expect(body).toEqual({ alert_status: '$ALERT_TRANSITION' });
  });
});

describe('resolveHookConfig — dựng lúc lưu (ADR-0046 §4)', () => {
  const appId = AppId.create();
  const templateId = TemplateId.create();
  const catalog = (info: Partial<TemplateInfo> | null): TemplateCatalog => ({
    publishedVariables: async () =>
      info === null ? null : { templateId, name: 'Alert', status: 'published', version: 1, variables: ALERT_VARS, ...info },
    render: async () => ({ subject: '', html: '', text: '' }),
  });
  const input = { name: 'Grafana', topicId: TopicId.create(), templateId, dedupePath: null };

  it('không công cụ: mappings mặc định [] , không điều kiện, trigger bị bỏ', async () => {
    expect(await resolveHookConfig(catalog({}), appId, { ...input, trigger: 'firing' })).toMatchObject({
      mappings: [],
      condition: null,
      integration: null,
      trigger: null,
    });
  });

  it('có công cụ, không gửi mappings / condition -> tự dựng theo bản đang xuất bản + trigger', async () => {
    const config = await resolveHookConfig(catalog({}), appId, { ...input, integration: 'grafana', trigger: 'firing' });
    expect(config.mappings.map((m) => m.variable)).toEqual(['payload.incident_title', 'payload.severity', 'payload.started_at', 'payload.detail_url']);
    expect([config.condition, config.integration, config.trigger]).toEqual([{ path: 'status', values: ['firing'] }, 'grafana', 'firing']);
    // Thiếu trigger = all; công cụ không trạng thái -> null.
    expect((await resolveHookConfig(catalog({}), appId, { ...input, integration: 'gatus' })).trigger).toBe('all');
    expect((await resolveHookConfig(catalog({}), appId, { ...input, integration: 'generic', trigger: 'firing' })).trigger).toBeNull();
  });

  it('gửi tường minh thì dùng đúng cái đã gửi', async () => {
    const mappings = [{ variable: 'payload.x', kind: 'fixed' as const, value: 'y' }];
    const config = await resolveHookConfig(catalog({}), appId, { ...input, integration: 'grafana', trigger: 'firing', mappings, condition: null });
    expect([config.mappings, config.condition]).toEqual([mappings, null]);
  });

  it('template chưa xuất bản -> lấy cả danh mục (xuất bản xong là chạy)', async () => {
    const config = await resolveHookConfig(catalog({ status: 'unpublished', version: null, variables: [] }), appId, { ...input, integration: 'alertmanager' });
    expect(config.mappings).toHaveLength(6);
  });

  it('công cụ lạ -> INTEGRATION_UNKNOWN', async () => {
    await expect(resolveHookConfig(catalog({}), appId, { ...input, integration: 'zabbix' })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'INTEGRATION_UNKNOWN', path: 'config.integration' })],
    });
  });
});

describe('describeHooks — setupBody + cảnh báo theo công cụ', () => {
  const appId = AppId.create();
  const topicId = TopicId.create();
  const templateId = TemplateId.create();
  const deps = (variables: TemplateInfo['variables']) => ({
    topics: { topicsOf: async () => [{ topicId, key: 'ops', status: 'active', mandatory: false }] },
    templates: {
      publishedVariables: async () => ({ templateId, name: 'Alert', status: 'published' as const, version: 2, variables }),
      render: async () => ({ subject: '', html: '', text: '' }),
    },
  });
  const hook = (integration: 'datadog' | 'grafana' | null, mappings: IncomingHook['mappings'] = []) =>
    new IncomingHook({
      id: IncomingHookId.create(),
      appId,
      slot: 1,
      name: 'h',
      topicId,
      templateId,
      mappings,
      dedupePath: null,
      condition: null,
      integration,
      trigger: integration === null ? null : 'firing',
      tokenHash: 'a'.repeat(64),
      tokenHint: 'ewshk_abcd…wxyz',
      createdAt: new Date('2026-10-23T00:00:00Z'),
    });

  it('custom: setupBody theo bản đang xuất bản, không cảnh báo "chưa ánh xạ"; fixed / hook cũ: setupBody null', async () => {
    const [datadog, grafana, legacy] = await describeHooks(deps(ALERT_VARS), appId, [
      hook('datadog'),
      hook('grafana', integrationMappings(integration('grafana'), [...ALERT_VARS, ...RESOLVED_VARS])),
      hook(null),
    ]);
    expect(datadog!.setupBody).toMatchObject({ incident_title: '$EVENT_TITLE', alert_status: '$ALERT_TRANSITION' });
    expect([datadog!.integration, datadog!.trigger, datadog!.warnings]).toEqual(['datadog', 'firing', []]);
    // Ánh xạ dựng theo danh mục mà template không khai (resolved_at, summary) — không cảnh báo.
    expect([grafana!.setupBody, grafana!.warnings]).toEqual([null, []]);
    expect([legacy!.setupBody, legacy!.integration, legacy!.trigger]).toEqual([null, null, null]);
    expect(legacy!.warnings.map((w) => w.code)).toContain('REQUIRED_VARIABLE_UNMAPPED');
  });
});
