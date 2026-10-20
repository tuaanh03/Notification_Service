import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, consumerRegistry, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, startWorker, type RunningApi } from '../../src/entrypoints/index.ts';
import type { AiCompletion, TemplateAiWriter } from '../../src/modules/templates/application/index.ts';
import type { AiChatMessage } from '../../src/modules/templates/domain/rules/ai-compose-prompt.ts';
import { templateVersions } from '../../src/modules/templates/infrastructure/db/schema.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, eventually, testRedisUrl } from './support/redis.ts';

/** AI giả: trả `reply`, ghi lại câu lệnh đã nhận — không gọi ra ngoài. */
class FakeAiWriter implements TemplateAiWriter {
  configured = true;
  reply = '{"subject":"S","html":"<p>H</p>","text":"T"}';
  calls: (readonly AiChatMessage[])[] = [];
  async complete(messages: readonly AiChatMessage[]): Promise<AiCompletion> {
    this.calls.push(messages);
    return { content: this.reply, model: 'fake-model', promptTokens: 1, completionTokens: 2 };
  }
}
const ai = new FakeAiWriter();

let ADMIN_TOKEN: string;
let ADMIN_ID: string;

let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let shop: { appId: string };
let other: { appId: string };

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 10 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c, { templateAiWriter: ai });
  api = await startApi(c, application);
  const signedIn = await signInAdmin(application, api.url);
  ADMIN_TOKEN = signedIn.token;
  ADMIN_ID = signedIn.adminId;
  http = httpClient(api.url);
  shop = await provisionApp(api.url, ADMIN_TOKEN, 'tpl-shop');
  other = await provisionApp(api.url, ADMIN_TOKEN, 'tpl-other');
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

function admin(method: string, path: string, body?: unknown) {
  return http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
}
const base = () => `/apps/${shop.appId}/templates`;
const codesOf = (body: Json) => ((body['issues'] ?? []) as Json[]).map((i) => i['code']);

/** Nội dung hợp lệ, xuất bản được ngay. */
const validDraft = {
  subject: '[Cảnh báo] {{ payload.vm_name }}',
  html: '<p>Máy ảo {{ payload.vm_name }} vượt ngưỡng.</p><p><a href="https://ews.example.com">Xem</a></p>',
  text: 'Máy ảo {{ payload.vm_name }} vượt ngưỡng.',
  variables: [{ name: 'payload.vm_name', source: 'payload', required: true, sample: 'ai-gateway' }],
};

async function createTemplate(name: string, content: Json = {}): Promise<string> {
  const res = await admin('POST', base(), { name, ...content });
  if (res.status !== 201) throw new Error(`create template: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body['id'] as string;
}

describe('tạo và đổi tên template', () => {
  it('tạo -> 201 kèm nháp v1; app không tồn tại -> 404; tên rỗng -> 422', async () => {
    const res = await admin('POST', base(), { name: '  Chào mừng  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Chào mừng',
      channel: 'email',
      status: 'active',
      publishedVersion: null,
      draftVersion: 1,
    });
    expect(res.body['versions']).toEqual([
      expect.objectContaining({ version: 1, status: 'draft', subject: '', createdBy: ADMIN_ID, publishedBy: null }),
    ]);

    expect((await admin('POST', '/apps/00000000-0000-4000-8000-000000000000/templates', { name: 'x' })).status).toBe(404);
    expect((await admin('POST', base(), { name: '   ' })).status).toBe(422);
  });

  // Collation utf8mb4_0900_ai_ci: không phân biệt hoa thường và dấu — cố ý (ADR-0020).
  it('tên trùng trong app — kể cả chỉ khác dấu / hoa thường — 409; app khác thì được', async () => {
    await createTemplate('Cảnh báo VM');
    for (const name of ['Cảnh báo VM', 'canh bao vm', 'CẢNH BÁO VM']) {
      const res = await admin('POST', base(), { name });
      expect(res.status).toBe(409);
      expect(res.body['code']).toBe('TEMPLATE_NAME_TAKEN');
    }
    expect((await admin('POST', `/apps/${other.appId}/templates`, { name: 'Cảnh báo VM' })).status).toBe(201);
  });

  it('đổi tên; trùng tên template khác -> 409', async () => {
    const id = await createTemplate('Tên cũ');
    await createTemplate('Tên đã có');
    const renamed = await admin('PATCH', `${base()}/${id}`, { name: 'Tên mới' });
    expect(renamed.status).toBe(200);
    expect(renamed.body['name']).toBe('Tên mới');
    expect((await admin('PATCH', `${base()}/${id}`, { name: 'tên đã có' })).body['code']).toBe('TEMPLATE_NAME_TAKEN');
  });
});

describe('nháp -> xuất bản -> phiên bản mới', () => {
  it('v1 xuất bản; nháp v2 từ v1; xuất bản v2 thì v1 thành superseded', async () => {
    const id = await createTemplate('Vòng đời');
    expect((await admin('PUT', `${base()}/${id}/draft`, validDraft)).status).toBe(200);

    const v1 = await admin('POST', `${base()}/${id}/publish`);
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({ publishedVersion: 1, draftVersion: null });
    expect(v1.body['versions'][0]).toMatchObject({ version: 1, status: 'published', publishedBy: ADMIN_ID });

    // Không có nháp thì không có gì để xuất bản.
    expect((await admin('POST', `${base()}/${id}/publish`)).body['code']).toBe('NO_DRAFT');

    const v2 = await admin('POST', `${base()}/${id}/draft/from/1`);
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ publishedVersion: 1, draftVersion: 2 });
    expect(v2.body['versions'][0]).toMatchObject({ version: 2, status: 'draft', subject: validDraft.subject });
    // Đã có nháp thì không tạo thêm nháp thứ hai.
    expect((await admin('POST', `${base()}/${id}/draft/from/1`)).body['code']).toBe('DRAFT_EXISTS');

    await admin('PUT', `${base()}/${id}/draft`, { ...validDraft, subject: 'Bản 2: {{ payload.vm_name }}' });
    const published = await admin('POST', `${base()}/${id}/publish`);
    expect(published.body).toMatchObject({ publishedVersion: 2, draftVersion: null });

    const detail = (await admin('GET', `${base()}/${id}`)).body;
    expect((detail['versions'] as Json[]).map((v) => [v['version'], v['status']])).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ]);
    expect(detail['versions'][0]['subject']).toBe('Bản 2: {{ payload.vm_name }}');

    // Bản đã xuất bản không sửa tại chỗ được — PUT draft tạo nháp v3 mới.
    const v3 = await admin('PUT', `${base()}/${id}/draft`, validDraft);
    expect(v3.body).toMatchObject({ publishedVersion: 2, draftVersion: 3 });
  });

  it('xuất bản nội dung lỗi -> 422 kèm từng lỗi; nháp vẫn là nháp', async () => {
    const id = await createTemplate('Nội dung lỗi');
    await admin('PUT', `${base()}/${id}/draft`, {
      subject: 'Chào {{ name }}',
      html: '<a href="javascript:alert(1)">x</a> {{ payload.missing }} {{ user.tags.first_name | default: "bạn" }} unsubscribe',
      variables: [],
    });
    const res = await admin('POST', `${base()}/${id}/publish`);
    expect(res.status).toBe(422);
    expect(codesOf(res.body).sort()).toEqual(
      [
        'HTML_URL_NOT_ALLOWED', // bộ kiểm HTML lúc xuất bản (ADR-0038, mặc định bật)
        'LINK_SCHEME_NOT_ALLOWED',
        'UNSUBSCRIBE_LINK_NOT_ALLOWED',
        'USER_VARIABLE_NOT_SUPPORTED',
        'VARIABLE_MISSING_SOURCE',
        'VARIABLE_NOT_IN_SCHEMA',
        'VARIABLE_NOT_IN_SCHEMA',
      ].sort(),
    );
    const detail = (await admin('GET', `${base()}/${id}`)).body;
    expect(detail).toMatchObject({ publishedVersion: null, draftVersion: 1 });
  });

  it('nháp HTML lớn hơn 64 KB lưu được (MEDIUMTEXT)', async () => {
    const id = await createTemplate('HTML lớn');
    const html = `<p>${'x'.repeat(100 * 1024)}</p>`;
    expect((await admin('PUT', `${base()}/${id}/draft`, { ...validDraft, html })).status).toBe(200);
    expect(((await admin('GET', `${base()}/${id}`)).body['versions'][0]['html'] as string).length).toBe(html.length);
  });

  it('danh sách: đúng app, có số version đang xuất bản / nháp / số biến', async () => {
    const id = await createTemplate('Trong danh sách', validDraft);
    await admin('POST', `${base()}/${id}/publish`);
    const list = (await admin('GET', base())).body as unknown as Json[];
    expect(list.find((x) => x['id'] === id)).toMatchObject({ publishedVersion: 1, draftVersion: null, variableCount: 1 });
    const others = (await admin('GET', `/apps/${other.appId}/templates`)).body as unknown as Json[];
    expect(others.some((x) => x['id'] === id)).toBe(false);
  });
});

describe('ranh giới app và lưu trữ', () => {
  it('template của app khác -> 404 ở mọi đường, như không tồn tại', async () => {
    const id = await createTemplate('Của shop', validDraft);
    const foreign = `/apps/${other.appId}/templates/${id}`;
    expect((await admin('GET', foreign)).status).toBe(404);
    expect((await admin('POST', `${foreign}/publish`)).status).toBe(404);
    expect((await admin('PUT', `${foreign}/draft`, validDraft)).status).toBe(404);
    expect((await admin('PATCH', foreign, { name: 'chiếm' })).status).toBe(404);
  });

  it('lưu trữ: không sửa / xuất bản / đổi tên được nữa; lưu trữ lại không lỗi', async () => {
    const id = await createTemplate('Sẽ lưu trữ', validDraft);
    await admin('POST', `${base()}/${id}/publish`);
    expect((await admin('POST', `${base()}/${id}/archive`)).body['status']).toBe('archived');
    expect((await admin('POST', `${base()}/${id}/archive`)).status).toBe(200);

    expect((await admin('PUT', `${base()}/${id}/draft`, validDraft)).body['code']).toBe('TEMPLATE_ARCHIVED');
    expect((await admin('POST', `${base()}/${id}/draft/from/1`)).body['code']).toBe('TEMPLATE_ARCHIVED');
    expect((await admin('PATCH', `${base()}/${id}`, { name: 'x' })).body['code']).toBe('TEMPLATE_ARCHIVED');
  });
});

// ADR-0033: nhóm cố định, tìm theo tên, nhân bản trong cùng app.
describe('nhóm, tìm theo tên, nhân bản', () => {
  const list = async (query = '') => (await admin('GET', `${base()}${query}`)).body as unknown as Json[];

  it('tạo có nhóm; bỏ trống = other; nhóm lạ -> 422', async () => {
    const res = await admin('POST', base(), { name: 'Nhóm cảnh báo', category: 'alert' });
    expect(res.status).toBe(201);
    expect(res.body['category']).toBe('alert');
    expect((await admin('POST', base(), { name: 'Không nhóm' })).body['category']).toBe('other');
    expect((await admin('POST', base(), { name: 'Nhóm lạ', category: 'marketing' })).status).toBe(422);
  });

  it('PATCH đổi nhóm, đổi tên, hoặc cả hai; body rỗng -> 422; đã lưu trữ -> TEMPLATE_ARCHIVED', async () => {
    const id = await createTemplate('Đổi nhóm');
    expect((await admin('PATCH', `${base()}/${id}`, { category: 'reminder' })).body).toMatchObject({
      name: 'Đổi nhóm',
      category: 'reminder',
    });
    expect((await admin('PATCH', `${base()}/${id}`, { name: 'Đổi nhóm 2', category: 'report' })).body).toMatchObject({
      name: 'Đổi nhóm 2',
      category: 'report',
    });
    expect((await admin('PATCH', `${base()}/${id}`, {})).status).toBe(422);
    expect((await admin('PATCH', `${base()}/${id}`, { category: 'x' })).status).toBe(422);
    await admin('POST', `${base()}/${id}/archive`);
    expect((await admin('PATCH', `${base()}/${id}`, { category: 'alert' })).body['code']).toBe('TEMPLATE_ARCHIVED');
  });

  it('lọc theo nhóm và tìm theo tên — không phân biệt hoa thường và dấu; % và _ là chữ thường', async () => {
    const a = await createTemplate('Lọc Sự cố máy chủ', { category: 'approval' });
    const b = await createTemplate('Lọc sự cố mạng', { category: 'system' });
    const pct = await createTemplate('Lọc 100% xong');

    expect((await list('?category=approval')).map((x) => x['id'])).toContain(a);
    expect((await list('?category=approval')).every((x) => x['category'] === 'approval')).toBe(true);
    expect((await list(`?q=${encodeURIComponent('loc su co')}`)).map((x) => x['id']).sort()).toEqual([a, b].sort());
    expect((await list(`?q=${encodeURIComponent('LỌC SỰ CỐ')}&category=system`)).map((x) => x['id'])).toEqual([b]);
    expect((await list(`?q=${encodeURIComponent('100%')}`)).map((x) => x['id'])).toEqual([pct]);
    expect(await list(`?q=${encodeURIComponent('Lọc_')}`)).toEqual([]);
    expect((await admin('GET', `${base()}?category=marketing`)).status).toBe(422);
    // App khác không lộ qua ô tìm.
    expect((await admin('GET', `/apps/${other.appId}/templates?q=${encodeURIComponent('Lọc')}`)).body).toEqual([]);
  });

  it('nhân bản: template mới chỉ có nháp v1 chép từ NHÁP nếu có; giữ nhóm; thiếu tên -> 422', async () => {
    const id = await createTemplate('Gốc có nháp', { ...validDraft, category: 'alert' });
    await admin('POST', `${base()}/${id}/publish`);
    await admin('POST', `${base()}/${id}/draft/from/1`);
    await admin('PUT', `${base()}/${id}/draft`, { ...validDraft, subject: 'Nháp mới {{ payload.vm_name }}' });

    // Backend không tự đặt tên (hậu tố theo ngôn ngữ do console ghép): thiếu / rỗng -> 422.
    expect((await admin('POST', `${base()}/${id}/duplicate`, {})).status).toBe(422);
    expect((await admin('POST', `${base()}/${id}/duplicate`, { name: '   ' })).status).toBe(422);

    const res = await admin('POST', `${base()}/${id}/duplicate`, { name: 'Gốc có nháp (copy)' });
    expect(res.status).toBe(201);
    expect(res.body['id']).not.toBe(id);
    expect(res.body).toMatchObject({
      name: 'Gốc có nháp (copy)',
      category: 'alert',
      status: 'active',
      publishedVersion: null,
      draftVersion: 1,
    });
    expect(res.body['versions']).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'draft',
        subject: 'Nháp mới {{ payload.vm_name }}',
        variables: validDraft.variables,
        createdBy: ADMIN_ID,
      }),
    ]);
    // Bản gốc không đổi gì.
    expect((await admin('GET', `${base()}/${id}`)).body).toMatchObject({ publishedVersion: 1, draftVersion: 2 });
  });

  it('nhân bản: không có nháp thì chép bản đang xuất bản; tên tự đặt; trùng tên -> 409', async () => {
    const id = await createTemplate('Gốc đã xuất bản', validDraft);
    await admin('POST', `${base()}/${id}/publish`);
    const res = await admin('POST', `${base()}/${id}/duplicate`, { name: 'Bản sao tự đặt' });
    expect(res.status).toBe(201);
    expect(res.body['name']).toBe('Bản sao tự đặt');
    expect((res.body['versions'] as Json[])[0]).toMatchObject({ subject: validDraft.subject, html: validDraft.html });

    expect((await admin('POST', `${base()}/${id}/duplicate`, { name: 'bản sao tự đặt' })).body['code']).toBe(
      'TEMPLATE_NAME_TAKEN',
    );
  });

  it('nhân bản bản gốc đã lưu trữ được — bản gốc vẫn archived; template app khác -> 404', async () => {
    const id = await createTemplate('Gốc lưu trữ', validDraft);
    await admin('POST', `${base()}/${id}/archive`);
    const res = await admin('POST', `${base()}/${id}/duplicate`, { name: 'Gốc lưu trữ (bản sao)' });
    expect(res.status).toBe(201);
    expect(res.body['status']).toBe('active');
    expect((await admin('GET', `${base()}/${id}`)).body['status']).toBe('archived');

    expect((await admin('POST', `/apps/${other.appId}/templates/${id}/duplicate`, { name: 'Chiếm' })).status).toBe(404);
  });
});

// ADR-0009: "tối đa 1 nháp" không ép được ở DB — khoá dòng templates rồi mới đọc.
describe('đồng thời', () => {
  it('5 admin cùng xuất bản một nháp -> đúng 1 thành công, còn lại 409 NO_DRAFT; DB có đúng 1 bản published', async () => {
    const id = await createTemplate('Race publish', validDraft);
    await admin('POST', `${base()}/${id}/publish`);
    await admin('POST', `${base()}/${id}/draft/from/1`);

    const results = await race(5, () => admin('POST', `${base()}/${id}/publish`));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);

    const published = await t.db
      .select()
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, id), eq(templateVersions.status, 'published')));
    expect(published.map((v) => v.version)).toEqual([2]);
  });

  it('5 admin cùng tạo nháp từ bản cũ -> đúng 1 nháp mới', async () => {
    const id = await createTemplate('Race draft', validDraft);
    await admin('POST', `${base()}/${id}/publish`);

    const results = await race(5, () => admin('POST', `${base()}/${id}/draft/from/1`));
    const responses = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(responses.filter((r) => r?.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r?.body['code'] === 'DRAFT_EXISTS')).toHaveLength(4);

    const drafts = await t.db
      .select()
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, id), eq(templateVersions.status, 'draft')));
    expect(drafts).toHaveLength(1);
  });
});

describe('audit end-to-end qua worker thật', () => {
  it('tạo / lưu nháp / xuất bản / lưu trữ đều có trong /admin/audit, đúng actor', async () => {
    const worker = await startWorker(c, consumerRegistry(application));
    try {
      const id = await createTemplate('Được audit');
      await admin('PUT', `${base()}/${id}/draft`, validDraft);
      await admin('POST', `${base()}/${id}/publish`);
      await admin('PATCH', `${base()}/${id}`, { category: 'alert' });
      await admin('POST', `${base()}/${id}/archive`);
      while ((await c.infra.outboxRelay.relayOnce()) > 0);

      let entries: Json[] = [];
      await eventually(async () => {
        entries = (await admin('GET', `/audit?targetType=Template&targetId=${id}`)).body as unknown as Json[];
        return entries.length >= 5;
      });
      expect(entries.map((e) => e['action']).sort()).toEqual(
        ['TemplateArchived', 'TemplateCategoryChanged', 'TemplateCreated', 'TemplateDraftSaved', 'TemplateVersionPublished'].sort(),
      );
      expect(entries.every((e) => e['actor'] === ADMIN_ID && e['source'] === 'admin_api')).toBe(true);
      expect(entries.find((e) => e['action'] === 'TemplateVersionPublished')).toMatchObject({
        before: { publishedVersion: null },
        after: { publishedVersion: 1 },
      });
      expect(entries.find((e) => e['action'] === 'TemplateCategoryChanged')).toMatchObject({
        before: { category: 'other' },
        after: { category: 'alert' },
      });
    } finally {
      await worker.stop();
    }
  });
});

// ADR-0020 §7: AI chỉ trả ĐỀ XUẤT — không ghi DB; chỉ dùng biến đã khai; kiểm bằng luật lúc xuất bản.
describe('Nhờ AI soạn — POST .../ai-compose', () => {
  const compose = (id: string, body: Record<string, unknown>, token = ADMIN_TOKEN) =>
    http('POST', `/admin${base()}/${id}/ai-compose`, { token, body });
  const variables = [{ name: 'payload.vm_name', required: true, description: 'Tên máy ảo' }];

  it('trả đề xuất + issues rỗng; KHÔNG ghi gì vào DB; câu lệnh chỉ có biến đã khai, không giá trị mẫu', async () => {
    const id = await createTemplate('AI đề xuất');
    ai.reply = '```json\n{"subject":"[Cảnh báo] {{ payload.vm_name }}","html":"<p>{{ payload.vm_name }}</p><a href=\\"https://a.vn\\">Xem</a>","text":"VM {{ payload.vm_name }}"}\n```';
    const res = await compose(id, { instruction: 'Cảnh báo VM quá tải', mode: 'new', variables });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      subject: '[Cảnh báo] {{ payload.vm_name }}',
      html: '<p>{{ payload.vm_name }}</p><a href="https://a.vn">Xem</a>',
      text: 'VM {{ payload.vm_name }}',
      suggestedVariables: [],
      issues: [],
    });
    const sent = ai.calls.at(-1)!.map((m) => m.content).join('\n');
    expect(sent).toContain('{{ payload.vm_name }} (required): Tên máy ảo');
    // Nháp v1 vẫn rỗng: AI không tự lưu.
    const detail = (await admin('GET', `${base()}/${id}`)).body;
    expect(detail['versions'][0]).toMatchObject({ version: 1, subject: '', html: '' });
  });

  it('AI dùng biến CHƯA khai / link http -> vẫn trả đề xuất, kèm issues để người soạn thấy', async () => {
    const id = await createTemplate('AI lỗi biến');
    ai.reply = '{"subject":"{{ payload.owner }}","html":"<a href=\\"http://x.vn\\">x</a>"}';
    const res = await compose(id, { instruction: 'x', mode: 'new', variables });
    expect(res.status).toBe(200);
    expect(codesOf(res.body).sort()).toEqual(['LINK_SCHEME_NOT_ALLOWED', 'VARIABLE_NOT_IN_SCHEMA']);
  });

  it('AI đề xuất biến mới -> trả kèm suggestedVariables, kiểm như đã thêm; template KHÔNG đổi biến', async () => {
    const id = await createTemplate('AI đề xuất biến');
    ai.reply = JSON.stringify({
      subject: '{{ payload.vm_name }} quá tải',
      html: '<p>{{ payload.vm_name }} - {{ payload.cpu }} - {{ payload.owner | default: "?" }}</p>',
      variables: [
        { name: 'cpu', required: true, description: 'Mức CPU', sample: '95%' },
        { name: 'owner', required: false },
        { name: 'vm_name' },
      ],
    });
    const res = await compose(id, { instruction: 'Cảnh báo VM quá tải, kèm mức CPU và người phụ trách', mode: 'new', variables });
    expect(res.status).toBe(200);
    expect(res.body['suggestedVariables']).toEqual([
      { name: 'payload.cpu', required: true, description: 'Mức CPU', sample: '95%' },
      { name: 'payload.owner', required: false },
    ]);
    expect(res.body['issues']).toEqual([]);
    const detail = (await admin('GET', `${base()}/${id}`)).body;
    expect(detail['versions'][0]['variables']).toEqual([]);
  });

  it('revise gửi kèm nội dung đang soạn; thiếu current -> 422', async () => {
    const id = await createTemplate('AI sửa');
    ai.reply = '{"subject":"S","html":"<p>H</p>"}';
    const current = { subject: 'Cũ', html: '<p>nội dung cũ</p>', text: '' };
    expect((await compose(id, { instruction: 'rút gọn', mode: 'revise', variables, current })).status).toBe(200);
    expect(ai.calls.at(-1)!.map((m) => m.content).join('\n')).toContain('<p>nội dung cũ</p>');
    expect((await compose(id, { instruction: 'rút gọn', mode: 'revise', variables })).status).toBe(422);
  });

  it('AI trả không phải JSON -> 502 AI_PROVIDER_ERROR', async () => {
    const id = await createTemplate('AI hỏng');
    ai.reply = 'Xin lỗi, tôi không làm được.';
    const res = await compose(id, { instruction: 'x', mode: 'new', variables: [] });
    expect(res.status).toBe(502);
    expect(res.body['code']).toBe('AI_PROVIDER_ERROR');
  });

  it('chưa cấu hình AI -> 503 AI_NOT_CONFIGURED; template app khác -> 404; đã lưu trữ -> 409', async () => {
    const id = await createTemplate('AI ranh giới');
    ai.configured = false;
    try {
      const res = await compose(id, { instruction: 'x', mode: 'new' });
      expect(res.status).toBe(503);
      expect(res.body['code']).toBe('AI_NOT_CONFIGURED');
    } finally {
      ai.configured = true;
    }
    expect((await http('POST', `/admin/apps/${other.appId}/templates/${id}/ai-compose`, { token: ADMIN_TOKEN, body: { instruction: 'x', mode: 'new' } })).status).toBe(404);
    await admin('POST', `${base()}/${id}/archive`);
    expect((await compose(id, { instruction: 'x', mode: 'new' })).body['code']).toBe('TEMPLATE_ARCHIVED');
  });

  it('quá 10 lần/phút cho MỘT admin -> 429 AI_RATE_LIMITED; admin khác vẫn gọi được', async () => {
    const id = await createTemplate('AI giới hạn');
    ai.reply = '{"subject":"S","html":"<p>H</p>"}';
    const busy = (await signInAdmin(application, api.url)).token;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await compose(id, { instruction: 'x', mode: 'new' }, busy)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await compose(id, { instruction: 'x', mode: 'new' }, (await signInAdmin(application, api.url)).token)).status).toBe(200);
  });
});

describe('bộ kiểm HTML lúc xuất bản kiểu html (ADR-0038)', () => {
  const setCheck = (value: boolean | null) => admin('PUT', '/system-settings', { values: { 'templates.html_check_enabled': value } });
  const dirtyHtml = '<p onclick="x()">Máy ảo {{ payload.vm_name }}</p><script>alert(1)</script>';
  const latest = (body: Json) => (body['versions'] as Json[])[0]!;

  afterAll(async () => {
    await setCheck(null);
  });

  it('mặc định bật: HTML sạch xuất bản được; HTML bẩn -> 422 từng mã (như visual), nháp vẫn lưu được và không bị sửa', async () => {
    const clean = await createTemplate('Kiểm HTML sạch', validDraft);
    expect((await admin('POST', `${base()}/${clean}/publish`)).status).toBe(200);

    const id = await createTemplate('Kiểm HTML bẩn', validDraft);
    const saved = await admin('PUT', `${base()}/${id}/draft`, { ...validDraft, html: dirtyHtml });
    expect(saved.status).toBe(200);
    const res = await admin('POST', `${base()}/${id}/publish`);
    expect(res.status).toBe(422);
    expect(codesOf(res.body)).toEqual(['HTML_ATTRIBUTE_NOT_ALLOWED', 'HTML_TAG_NOT_ALLOWED']);
    expect(((res.body['issues'] ?? []) as Json[]).every((i) => i['path'] === 'html')).toBe(true);
    const after = (await admin('GET', `${base()}/${id}`)).body;
    expect(after).toMatchObject({ publishedVersion: null, draftVersion: 1 });
    expect(latest(after)['html']).toBe(dirtyHtml);
  });

  it('tắt công tắc: HTML bẩn xuất bản được như trước; bật lại thì bản đã xuất bản vẫn gửi, chỉ bản MỚI bị chặn', async () => {
    const id = await createTemplate('Kiểm HTML tắt', { ...validDraft, html: dirtyHtml });
    expect((await setCheck(false)).status).toBe(200);
    expect((await admin('POST', `${base()}/${id}/publish`)).status).toBe(200);

    expect((await setCheck(true)).status).toBe(200);
    // Bản đã xuất bản không bị đụng: vẫn là bản đang dùng, đổ biến / gửi như cũ.
    const rendered = await admin('POST', `${base()}/${id}/render`, { payload: { vm_name: 'vm-01' } });
    expect(rendered.status).toBe(200);
    expect(rendered.body['html']).toContain('<script>');
    // Nháp mới chép từ bản đó thì bị chặn khi xuất bản; v1 vẫn published.
    expect((await admin('POST', `${base()}/${id}/draft/from/1`)).status).toBe(201);
    const blocked = await admin('POST', `${base()}/${id}/publish`);
    expect(blocked.status).toBe(422);
    expect((await admin('GET', `${base()}/${id}`)).body).toMatchObject({ publishedVersion: 1, draftVersion: 2 });
  });
});

describe('kiểu kéo-thả đã gỡ (ADR-0037, migration 0027)', () => {
  it('editor blocks là kiểu lạ -> 422; route design-preview / convert-to-html không còn', async () => {
    const created = await admin('POST', base(), { name: 'Kéo thả', editor: 'blocks' });
    expect(created.status).toBe(422);
    const id = await createTemplate('Kéo thả qua lưu nháp', validDraft);
    expect((await admin('PUT', `${base()}/${id}/draft`, { editor: 'blocks', subject: 'x', design: {}, variables: [] })).status).toBe(422);
    expect((await admin('POST', `${base()}/design-preview`, { design: {} })).status).toBe(404);
    expect((await admin('POST', `${base()}/${id}/draft/convert-to-html`)).status).toBe(404);
  });
});

describe('bộ soạn trực quan (ADR-0036)', () => {
  /** HTML thật do GrapesJS + grapesjs-mjml sinh (có nhánh [if mso], biến trong href, user.external_id). */
  const mjmlHtml = readFileSync(new URL('../unit/fixtures/grapesjs-mjml-email.html', import.meta.url), 'utf8');
  const mjml = readFileSync(new URL('../unit/fixtures/grapesjs-mjml-email.mjml', import.meta.url), 'utf8');
  const visualDesign = { format: 'grapesjs-mjml', version: 1, project: { pages: [{ id: 'p1' }] }, mjml };
  const visualDraft = {
    editor: 'visual',
    subject: '[Cảnh báo] {{ payload.vm_name }}',
    html: mjmlHtml,
    design: visualDesign,
    variables: [
      { name: 'payload.vm_name', source: 'payload', required: true, sample: 'ai-gateway' },
      { name: 'payload.name', source: 'payload', required: false },
      { name: 'payload.detail_url', source: 'payload', required: false },
      { name: 'user.external_id', source: 'user', required: true },
    ],
  };
  const latest = (body: Json) => (body['versions'] as Json[])[0]!;

  it('luôn bật (ADR-0037 gỡ cờ): tạo kiểu visual -> 201 thư trống; html + design phải đi cùng nhau; route cờ cũ đã gỡ', async () => {
    const created = await admin('POST', base(), { name: 'Trực quan 0', editor: 'visual' });
    expect(created.status).toBe(201);
    expect(latest(created.body)).toMatchObject({ editor: 'visual', html: '', text: '', design: { format: 'grapesjs-mjml', version: 1, project: {}, mjml: '' } });
    expect((await admin('POST', base(), { name: 'Trực quan 0b', editor: 'visual', html: '<p>x</p>' })).status).toBe(422);
    expect((await admin('GET', '/template-editor-options')).status).toBe(404);
  });

  it('lưu nháp: HTML đã kiểm giữ nguyên, backend sinh text; xuất bản bằng validate() cũ; gửi đổ biến', async () => {
    const id = await createTemplate('Trực quan 1', { editor: 'visual' });
    const saved = await admin('PUT', `${base()}/${id}/draft`, visualDraft);
    expect(saved.status).toBe(200);
    const v1 = latest(saved.body);
    expect(v1).toMatchObject({ editor: 'visual', html: mjmlHtml, design: visualDesign });
    expect(v1['text']).toContain('Cảnh báo: {{ payload.vm_name }}');
    expect(v1['text']).not.toContain('<');

    expect((await admin('POST', `${base()}/${id}/publish`)).status).toBe(200);
    const rendered = await admin('POST', `${base()}/${id}/render`, { payload: { vm_name: '<vm-01>', name: 'An' }, externalId: 'u-1' });
    expect(rendered.status).toBe(200);
    expect(rendered.body['html']).toContain('Cảnh báo: &lt;vm-01&gt;');
    expect(rendered.body['html']).toContain('Xin chào An');
    expect(rendered.body['html']).toContain('href="https://eon.vn"');
    expect(rendered.body['html']).toContain('<!--[if mso | IE]>');
  });

  it('HTML không an toàn -> 422 kèm từng mã, KHÔNG ghi; text gửi lên -> 422; &quot; trong biến được chuẩn hoá', async () => {
    const id = await createTemplate('Trực quan 2', { editor: 'visual' });
    const bad = await admin('PUT', `${base()}/${id}/draft`, {
      ...visualDraft,
      html: '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><img src="http://x.vn/a.png">',
    });
    expect(bad.status).toBe(422);
    expect(codesOf(bad.body)).toEqual(['HTML_ATTRIBUTE_NOT_ALLOWED', 'HTML_TAG_NOT_ALLOWED', 'HTML_URL_NOT_ALLOWED', 'IMAGE_URL_NOT_ALLOWED']);
    expect(latest((await admin('GET', `${base()}/${id}`)).body)['html']).toBe('');
    expect((await admin('PUT', `${base()}/${id}/draft`, { ...visualDraft, text: 'x' })).status).toBe(422);
    const tooBig = await admin('PUT', `${base()}/${id}/draft`, { ...visualDraft, design: { ...visualDesign, mjml: 'x'.repeat(64_001) } });
    expect(codesOf(tooBig.body)).toEqual(['DESIGN_TOO_LARGE']);

    const quoted = await admin('PUT', `${base()}/${id}/draft`, {
      ...visualDraft,
      html: '<p>Hi {{ payload.vm_name }}</p><a href="{{ payload.detail_url | default: &quot;https://x.vn&quot; }}">Xem</a>',
    });
    expect(quoted.status).toBe(200);
    expect(latest(quoted.body)['html']).toContain(`href="{{ payload.detail_url | default: 'https://x.vn' }}"`);
  });

  it('nháp khác kiểu -> 409 EDITOR_MISMATCH', async () => {
    const htmlId = await createTemplate('Trực quan 3 html', validDraft);
    expect((await admin('PUT', `${base()}/${htmlId}/draft`, visualDraft)).body['code']).toBe('EDITOR_MISMATCH');
    const id = await createTemplate('Trực quan 3', { editor: 'visual' });
    expect((await admin('PUT', `${base()}/${id}/draft`, validDraft)).body['code']).toBe('EDITOR_MISMATCH');
  });

  it('xuất bản / tạo nháp từ bản cũ / nhân bản chép cả editor + design', async () => {
    const id = await createTemplate('Trực quan 4', { editor: 'visual' });
    expect((await admin('PUT', `${base()}/${id}/draft`, visualDraft)).status).toBe(200);
    expect((await admin('POST', `${base()}/${id}/publish`)).status).toBe(200);
    const v2 = latest((await admin('POST', `${base()}/${id}/draft/from/1`)).body);
    expect(v2).toMatchObject({ version: 2, editor: 'visual', design: visualDesign, html: mjmlHtml });
    const copy = await admin('POST', `${base()}/${id}/duplicate`, { name: 'Trực quan 4 (bản sao)' });
    expect(copy.status).toBe(201);
    expect(latest(copy.body)).toMatchObject({ editor: 'visual', design: visualDesign });
  });

  it('admin-cli chạy thử: liệt kê template kiểu html sẽ bị chặn, không ghi gì', async () => {
    const id = await createTemplate('HTML có script', { ...validDraft, html: '<p>x</p><script>alert(1)</script>' });
    const before = (await t.db.select().from(templateVersions)).length;
    const { scanned, findings } = await application.adminOps.scanHtmlTemplates.execute();
    expect(scanned).toBeGreaterThan(0);
    const mine = findings.filter((f) => f.templateId === id);
    expect(mine).toEqual([expect.objectContaining({ name: 'HTML có script', version: 1, status: 'draft', codes: ['HTML_TAG_NOT_ALLOWED'] })]);
    expect(findings.every((f) => f.codes.length > 0)).toBe(true);
    expect((await t.db.select().from(templateVersions)).length).toBe(before);
  });
});

describe('thư viện mẫu (ADR-0035, ADR-0037)', () => {
  /** HTML THẬT do mjml-browser biên dịch từ MJML của mẫu — đúng thứ console gửi lên khi "Dùng mẫu". */
  const compiled = JSON.parse(readFileSync(new URL('../unit/fixtures/preset-html.json', import.meta.url), 'utf8')) as {
    presets: Record<string, { html: string }>;
  };
  const project = { pages: [{ id: 'p1' }] };
  /** Thân "Dùng mẫu" như console gửi: MJML của mẫu (từ thư viện) + HTML biên dịch + dự án GrapesJS. */
  async function presetBody(presetId: string, locale: 'vi' | 'en', name: string): Promise<Json> {
    const preset = ((await admin('GET', `/template-presets?locale=${locale}`)).body as unknown as Json[]).find((p) => p['id'] === presetId);
    return {
      presetId,
      locale,
      name,
      html: compiled.presets[`${presetId}/${locale}`]?.html ?? '<p>x</p>',
      design: { format: 'grapesjs-mjml', version: 1, project, mjml: (preset?.['mjml'] as string | undefined) ?? '<mjml></mjml>' },
    };
  }
  const fromPreset = (body: Json) => admin('POST', `${base()}/from-preset`, body);
  const latest = (body: Json) => (body['versions'] as Json[])[0]!;

  it('GET /template-presets: 12 mẫu, mặc định tiếng Việt, có mjml + html ảnh thu nhỏ; lọc nhóm; locale lạ -> 422', async () => {
    const vi = await admin('GET', '/template-presets');
    expect(vi.status).toBe(200);
    const list = vi.body as unknown as Json[];
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ id: 'incident-alert', version: 1, category: 'alert', locale: 'vi', name: 'Cảnh báo sự cố' });
    expect(list[0]!['mjml']).toMatch(/^<mjml>/);
    expect(list[0]!['html']).toContain('<!DOCTYPE html>');
    expect((list[0]!['variables'] as Json[]).map((v) => v['name'])).toContain('payload.detail_url');

    const en = (await admin('GET', '/template-presets?locale=en&category=report')).body as unknown as Json[];
    expect(en.map((p) => [p['id'], p['name']])).toEqual([['periodic-report', 'Periodic report']]);
    expect((await admin('GET', '/template-presets?category=other')).body).toEqual([]);
    expect((await admin('GET', '/template-presets?locale=fr')).status).toBe(422);
    expect((await http('GET', '/admin/template-presets', {})).status).toBe(401);
  });

  it('tạo từ mẫu -> 201, nháp v1 kiểu visual đúng nhóm + tiêu đề + biến của mẫu, HTML đã kiểm; xuất bản được ngay; gửi đổ biến', async () => {
    const preset = ((await admin('GET', '/template-presets?locale=en')).body as unknown as Json[]).find((p) => p['id'] === 'task-due-reminder')!;
    const body = await presetBody('task-due-reminder', 'en', 'Task due (preset)');
    const res = await fromPreset(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Task due (preset)', category: 'reminder', editor: 'visual', draftVersion: 1, publishedVersion: null });
    const draft = latest(res.body);
    expect(draft).toMatchObject({ version: 1, status: 'draft', editor: 'visual', subject: preset['subject'], design: body['design'] });
    expect(draft['html']).toBe(body['html']);
    expect(draft['text']).toContain('{{ payload.task_name }}');
    expect(draft['variables']).toEqual(preset['variables']);

    const id = res.body['id'] as string;
    expect((await admin('POST', `${base()}/${id}/publish`)).status).toBe(200);
    const rendered = await admin('POST', `${base()}/${id}/render`, {
      payload: { task_name: 'Q3 <report>', due_at: 'Friday', task_url: 'https://work.example.com/t/1' },
    });
    expect(rendered.status).toBe(200);
    expect(rendered.body['subject']).toBe('Reminder: Q3 <report> is due soon');
    expect(rendered.body['html']).toContain('Q3 &lt;report&gt;');
    expect(rendered.body['html']).toContain('href="https://work.example.com/t/1"');
  });

  it('mẫu lạ -> 404; trùng tên -> 409; thiếu html / design, HTML không an toàn, locale sai / thiếu tên -> 422; app khác org -> 404', async () => {
    const missing = await fromPreset({ ...(await presetBody('welcome', 'vi', 'X')), presetId: 'no-such-preset' });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND', detail: 'template preset no-such-preset not found' });

    const welcome = await presetBody('welcome', 'vi', 'Chào mừng (mẫu)');
    expect((await fromPreset(welcome)).status).toBe(201);
    const taken = await fromPreset({ ...welcome, name: 'chao mung (mau)' });
    expect(taken.status).toBe(409);
    expect(taken.body['code']).toBe('TEMPLATE_NAME_TAKEN');

    // Console cũ (chỉ gửi presetId / locale / name) không tạo được nữa — HTML phải do trình duyệt biên dịch.
    expect((await fromPreset({ presetId: 'welcome', locale: 'vi', name: 'Y' })).status).toBe(422);
    const unsafe = await fromPreset({ ...welcome, name: 'Y', html: '<p>x</p><script>alert(1)</script>' });
    expect([unsafe.status, codesOf(unsafe.body)]).toEqual([422, ['HTML_TAG_NOT_ALLOWED']]);
    expect((await fromPreset({ ...welcome, name: 'Y', locale: 'fr' })).status).toBe(422);
    expect((await fromPreset({ ...welcome, name: '  ' })).status).toBe(422);
    expect((await admin('POST', '/apps/00000000-0000-4000-8000-000000000000/templates/from-preset', { ...welcome, name: 'Z' })).status).toBe(404);
  });

  it('audit TemplateCreated ghi after.createdFromPreset qua worker thật', async () => {
    const worker = await startWorker(c, consumerRegistry(application));
    try {
      const res = await fromPreset(await presetBody('periodic-report', 'vi', 'Báo cáo tháng (mẫu)'));
      const id = res.body['id'] as string;
      while ((await c.infra.outboxRelay.relayOnce()) > 0);
      let entries: Json[] = [];
      await eventually(async () => {
        entries = (await admin('GET', `/audit?targetType=Template&targetId=${id}`)).body as unknown as Json[];
        return entries.length >= 1;
      });
      expect(entries[0]).toMatchObject({
        action: 'TemplateCreated',
        after: { category: 'report', editor: 'visual', createdFromPreset: { presetId: 'periodic-report', presetVersion: 1, locale: 'vi' } },
      });
    } finally {
      await worker.stop();
    }
  });
});
