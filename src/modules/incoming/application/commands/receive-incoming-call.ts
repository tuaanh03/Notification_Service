import type { CommandContext } from '../../../../shared/application/index.ts';
import {
  DomainError,
  IncomingCallId,
  NotFoundError,
  PublicationId,
  RateLimitedError,
  ValidationError,
  type Clock,
  type IncomingCallOutcome,
} from '../../../../shared/kernel/index.ts';
import type { IncomingHook } from '../../domain/entities/incoming-hook.ts';
import { assertNoIssues, conditionMet, extractPayload } from '../../domain/rules/index.ts';
import type { IncomingCallResult } from '../dto.ts';
import type {
  AppIngress,
  HookCrypto,
  HookRateLimiter,
  HttpStatusOf,
  IncomingCallRepository,
  IncomingHookRepository,
  IncomingSettings,
  TemplateCatalog,
  TopicCatalog,
  TopicPublisher,
} from '../ports/index.ts';
import { dedupeKeyOf } from './dedupe-key.ts';

/**
 * `POST /hooks/:token` — công cụ ngoài (Gatus, JSON tự build…) phát tin vào topic (ADR-0030).
 *
 *   token -> hook đang bật (sai / tắt -> 404, như không tồn tại)
 *   -> app gửi được + qua allowlist IP / Origin (cùng luật `/v1`)
 *   -> điều kiện phát (không thoả -> 200 skipped, không tính giới hạn)
 *   -> giới hạn số lần phát mỗi phút của hook (429)
 *   -> rút biến theo ánh xạ -> khoá chống trùng -> `PublishToTopic` (202 mới / 200 trùng)
 *
 * Mọi lần gọi của hook có thật đều vào nhật ký (kể cả bị từ chối), KHÔNG lưu body gốc.
 */
export class ReceiveIncomingCall {
  private readonly deps: {
    clock: Clock;
    hooks: IncomingHookRepository;
    calls: IncomingCallRepository;
    crypto: HookCrypto;
    ingress: AppIngress;
    templates: TemplateCatalog;
    topics: TopicCatalog;
    publisher: TopicPublisher;
    settings: IncomingSettings;
    limiter: HookRateLimiter;
    httpStatusOf: HttpStatusOf;
  };

  constructor(deps: ReceiveIncomingCall['deps']) {
    this.deps = deps;
  }

  async execute(input: {
    token: string;
    body: unknown;
    idempotencyKey: string | null;
    ip: string;
    origin: string | null;
  }): Promise<IncomingCallResult> {
    const hook = await this.deps.hooks.findByTokenHash(this.deps.crypto.sha256(input.token));
    // Token sai và hook đang tắt trả CÙNG một lỗi — không cho người dò token biết mình đoán trúng.
    if (!hook || hook.status !== 'active') throw new NotFoundError('incoming webhook', 'for this token');
    try {
      const result = await this.handle(hook, input);
      await this.log(hook, result.status === 'skipped' ? 200 : result.status === 'published' ? 202 : 200, result.status, {
        publicationId: result.status === 'skipped' ? null : result.publicationId,
        recipientCount: result.status === 'skipped' ? null : result.recipientCount,
        errorCode: result.status === 'skipped' ? result.reason : null,
      });
      return result;
    } catch (err) {
      if (err instanceof DomainError) {
        const code = err instanceof ValidationError ? (err.issues[0]?.code ?? err.code) : err.code;
        await this.log(hook, this.deps.httpStatusOf(err), 'rejected', { publicationId: null, recipientCount: null, errorCode: code });
      }
      throw err;
    }
  }

  private async handle(
    hook: IncomingHook,
    input: { body: unknown; idempotencyKey: string | null; ip: string; origin: string | null },
  ): Promise<IncomingCallResult> {
    const { clock, crypto, ingress, templates, topics, publisher, settings, limiter } = this.deps;
    const app = await ingress.authorize({ appId: hook.appId, ip: input.ip, origin: input.origin });
    if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
      throw ValidationError.of('INCOMING_BODY_INVALID', 'body must be a JSON object', 'body');
    }
    if (!conditionMet(input.body, hook.condition)) return { status: 'skipped', reason: 'condition_not_met' };

    const config = await settings.current();
    if (!(await limiter.tryAcquire(hook.id, config.maxPublicationsPerMinute))) {
      throw new RateLimitedError(
        'INCOMING_HOOK_RATE_LIMITED',
        `incoming webhook publishes at most ${config.maxPublicationsPerMinute} times per minute`,
      );
    }

    const template = await templates.publishedVariables(hook.appId, hook.templateId);
    if (!template) throw ValidationError.of('TEMPLATE_NOT_FOUND', `template ${hook.templateId} does not exist`, 'templateId');
    const extraction = extractPayload(input.body, hook.mappings, template.variables);
    assertNoIssues(extraction.issues);
    const topic = (await topics.topicsOf(hook.appId)).find((t) => t.topicId === hook.topicId);
    if (!topic) throw ValidationError.of('TOPIC_NOT_FOUND', `topic ${hook.topicId} does not exist`, 'topic');

    const dedupe = dedupeKeyOf(crypto, {
      hookId: hook.id,
      body: input.body,
      header: input.idempotencyKey,
      dedupePath: hook.dedupePath,
      at: clock.now(),
      windowMinutes: config.dedupeWindowMinutes,
    });
    const ctx: CommandContext = { actor: { id: hook.id, type: 'system' }, source: 'incoming_webhook' };
    const published = await publisher.publish(
      {
        appId: hook.appId,
        grantedChannels: app.grantedChannels,
        topic: topic.key,
        templateId: hook.templateId,
        payload: extraction.payload,
        idempotencyKey: dedupe.key,
      },
      ctx,
    );
    return {
      status: published.created ? 'published' : 'duplicate',
      publicationId: published.publicationId,
      recipientCount: published.recipientCount,
    };
  }

  private async log(
    hook: IncomingHook,
    httpStatus: number,
    outcome: IncomingCallOutcome,
    extra: { publicationId: string | null; recipientCount: number | null; errorCode: string | null },
  ): Promise<void> {
    await this.deps.calls.insert({
      id: IncomingCallId.create(),
      hookId: hook.id,
      appId: hook.appId,
      at: this.deps.clock.now(),
      httpStatus,
      outcome,
      publicationId: extra.publicationId === null ? null : PublicationId.parse(extra.publicationId),
      recipientCount: extra.recipientCount,
      errorCode: extra.errorCode?.slice(0, 64) ?? null,
    });
  }
}
