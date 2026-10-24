import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, adminContext, doc, EXTERNAL_ID, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
import { AppId, TOPIC_DEFAULT_MODES } from '../../../../shared/kernel/index.ts';
import type { CreateTopic, GetUserPreferences, SetTopicMandatory, TopicQueries, TransitionTopic } from '../../application/index.ts';

/** Key dùng trong API gửi (`topic: "order_updates"`): chữ thường, số, `_ . -`, bắt đầu bằng chữ. */
export const TOPIC_KEY = z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/, 'lowercase letters, digits and _ . -, 2-128 chars');

const appParams = z.object({ appId: z.string().uuid() });
const actionParams = appParams.extend({ key: TOPIC_KEY, action: z.enum(['activate', 'suspend']) });
const keyParams = appParams.extend({ key: TOPIC_KEY });
const userParams = appParams.extend({ externalId: EXTERNAL_ID });
const mandatoryBody = z.object({ mandatory: z.boolean() }).strict();
const createBody = z
  .object({
    key: TOPIC_KEY,
    name: z.string().trim().min(1).max(200),
    mandatory: z.boolean().default(false),
    defaultMode: z.enum(TOPIC_DEFAULT_MODES).default('opt_out'),
  })
  .strict();

/**
 * `/admin/apps/:appId/topics` — CHỈ admin tạo topic và đặt `mandatory` (ADR-0016 D6); app không tự đặt
 * qua `/v1`. Người quản lý app (`app.manage`: Owner, Org Admin, App Admin) đặt / bỏ bắt buộc, lúc tạo
 * hay sau khi tạo — bổ sung ADR-0022, trước đây chỉ Super Admin.
 */
export function adminTopicsRoutes(useCases: {
  createTopic: CreateTopic;
  transitionTopic: TransitionTopic;
  setTopicMandatory: SetTopicMandatory;
  queries: TopicQueries;
  getUserPreferences: GetUserPreferences;
}): HttpRoutes {
  return (app) => {
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const tag = 'topics';

    app.post(
      '/apps/:appId/topics',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Create a topic (starts as `draft`: apps cannot send to it until activated).',
            description:
              '`key` is what apps send in `topic` — unique per app, cannot be changed. `defaultMode`: `opt_out` = everyone receives until they turn it off, `opt_in` = nobody until they turn it on. `mandatory` topics cannot be turned off by users.',
            params: appParams,
            body: createBody,
            example: { key: 'vm_alerts', name: 'VM alerts', mandatory: false, defaultMode: 'opt_out' },
            status: 201,
            responseDto: 'TopicDto',
            errors: [{ status: 409, code: 'TOPIC_KEY_TAKEN' }],
          }),
        },
      },
      async (request, reply) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(createBody, request.body);
        return reply.status(201).send(await useCases.createTopic.execute({ appId: AppId.parse(appId), ...body }, ctx(request)));
      },
    );

    app.get(
      '/apps/:appId/topics',
      {
        config: { ...access('app.read'), ...doc({ tag, summary: 'List every topic of an app, in any status.', params: appParams, responseDto: 'TopicDto[]' }) },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        return useCases.queries.listForAdmin(AppId.parse(appId));
      },
    );

    app.post(
      '/apps/:appId/topics/:key/:action',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Activate or suspend a topic.',
            description:
              'Transitions: `draft` -> activate -> `active` -> suspend -> `suspended` -> activate -> `active`. Suspending stops new sends to the topic but keeps every user preference.',
            params: actionParams,
            responseDto: 'TopicDto',
            errors: [{ status: 409, code: 'INVALID_TRANSITION' }],
          }),
        },
      },
      async (request) => {
        const { appId, key, action } = parseInput(actionParams, request.params);
        return useCases.transitionTopic.execute({ appId: AppId.parse(appId), key, transition: action }, ctx(request));
      },
    );

    app.put(
      '/apps/:appId/topics/:key/mandatory',
      {
        config: {
          ...access('app.manage'),
          ...doc({
            tag,
            summary: 'Mark a topic as mandatory or optional.',
            description: 'Mandatory topics reach users even if they turned the topic or all optional messages off; only a missing, suppressed or invalid address still blocks them.',
            params: keyParams,
            body: mandatoryBody,
            responseDto: 'TopicDto',
          }),
        },
      },
      async (request) => {
        const { appId, key } = parseInput(keyParams, request.params);
        const { mandatory } = parseInput(mandatoryBody, request.body);
        return useCases.setTopicMandatory.execute({ appId: AppId.parse(appId), key, mandatory }, ctx(request));
      },
    );

    /*
     * Bề mặt ĐỌC cho vận hành (plan §5, ĐX-0004): cài đặt nhận tin của một người.
     *
     * Path nằm dưới `/users` nhưng thuộc module topics — cùng lý do với `/v1/users/:id/preferences`:
     * bề mặt HTTP không phải ranh giới module. Và đây là CÙNG use case mà `/v1` dùng, nên
     * `effectiveOptIn` hiện trên màn quản trị luôn khớp thứ worker tính lúc gửi (ADR-0010).
     *
     * KHÔNG có bản PUT ở đây: admin không sửa consent hộ người dùng.
     */
    app.get(
      '/apps/:appId/users/:externalId/preferences',
      {
        config: {
          ...access('app.read'),
          ...doc({
            tag: 'users',
            summary: "Read one recipient's preferences (read-only: admins never change consent on a user's behalf).",
            description:
              '`optedIn` = what the person chose (`null` = not chosen, follows `defaultMode`). `effectiveOptIn` = passes the topic layer ONLY — a dead address or `optedOutOptional` still blocks the email.',
            params: userParams,
            responseDto: 'UserPreferencesDto',
          }),
        },
      },
      async (request) => {
        const { appId, externalId } = parseInput(userParams, request.params);
        return useCases.getUserPreferences.execute({ appId: AppId.parse(appId), externalId });
      },
    );
  };
}
