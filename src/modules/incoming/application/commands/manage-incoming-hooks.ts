import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  IncomingHookId,
  type AppId,
  type Clock,
  type IncomingHookStatus,
} from '../../../../shared/kernel/index.ts';
import { IncomingHook, MAX_INCOMING_HOOKS, type IncomingHookConfig } from '../../domain/entities/incoming-hook.ts';
import type { IncomingHookDto, IssuedHookUrlDto } from '../dto.ts';
import { IncomingSlotTakenError } from '../errors.ts';
import { INCOMING_HOOK_AGGREGATE, INCOMING_HOOK_EVENTS } from '../events.ts';
import type {
  HookCrypto,
  IncomingCallRepository,
  IncomingHookRepository,
  IncomingSettings,
  TemplateCatalog,
  TopicCatalog,
} from '../ports/index.ts';
import { describeHooks } from '../queries/describe-hooks.ts';
import { assertTargetsBelongToApp, hookUrl, requireHook } from './shared.ts';

interface Deps {
  uow: UnitOfWork;
  outbox: EventOutbox;
  clock: Clock;
  hooks: IncomingHookRepository;
  calls: IncomingCallRepository;
  crypto: HookCrypto;
  topics: TopicCatalog;
  templates: TemplateCatalog;
  settings: IncomingSettings;
}

const auditEvent = (hook: IncomingHook, eventType: string, ctx: CommandContext, after: Record<string, unknown>) => ({
  aggregateType: INCOMING_HOOK_AGGREGATE,
  aggregateId: hook.id,
  eventType,
  payload: audited(ctx, { after: { appId: hook.appId, ...after } }),
});

/** Cấu hình đưa vào audit — không có token / băm token. */
const configOf = (hook: IncomingHook) => ({
  name: hook.name,
  topicId: hook.topicId,
  templateId: hook.templateId,
  mappings: hook.mappings,
  dedupePath: hook.dedupePath,
  condition: hook.condition,
});

async function describe(deps: Deps, hook: IncomingHook): Promise<IncomingHookDto> {
  return (await describeHooks(deps, hook.appId, [hook]))[0]!;
}

async function issuedUrl(deps: Deps, hook: IncomingHook, token: string): Promise<IssuedHookUrlDto> {
  const { publicBaseUrl } = await deps.settings.current();
  return { hook: await describe(deps, hook), token, ...hookUrl(publicBaseUrl, token) };
}

/**
 * Thêm hook (ADR-0030). Tối đa 10 mỗi app — unique `(app_id, slot)` quyết khi chạy song song: bên thua
 * đọc lại rồi thử chỗ khác; hết chỗ -> 422 INCOMING_HOOK_LIMIT_REACHED. Token chỉ nằm trong response này.
 */
export class CreateIncomingHook {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; config: IncomingHookConfig }, ctx: CommandContext): Promise<IssuedHookUrlDto> {
    const { uow, outbox, clock, hooks, crypto } = this.deps;
    await assertTargetsBelongToApp(this.deps, input.appId, input.config);
    const token = crypto.issueToken();
    for (let attempt = 0; ; attempt++) {
      try {
        const hook = await uow.run(async () => {
          const slot = IncomingHook.freeSlot((await hooks.listByApp(input.appId)).map((h) => h.slot));
          IncomingHook.assertHasFreeSlot(slot);
          const created = new IncomingHook({
            id: IncomingHookId.create(),
            appId: input.appId,
            slot,
            ...input.config,
            tokenHash: token.hash,
            tokenHint: token.hint,
            createdBy: ctx.actor.id,
            createdAt: clock.now(),
          });
          await hooks.insert(created);
          await outbox.append([auditEvent(created, INCOMING_HOOK_EVENTS.created, ctx, configOf(created))]);
          return created;
        });
        return issuedUrl(this.deps, hook, token.token);
      } catch (err) {
        if (!(err instanceof IncomingSlotTakenError) || attempt >= MAX_INCOMING_HOOKS) throw err;
      }
    }
  }
}

/** Sửa cấu hình và / hoặc tắt / bật. Không đổi token. */
export class UpdateIncomingHook {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; hookId: IncomingHookId; config?: IncomingHookConfig | undefined; status?: IncomingHookStatus | undefined },
    ctx: CommandContext,
  ): Promise<IncomingHookDto> {
    const { uow, outbox, clock, hooks } = this.deps;
    if (input.config) await assertTargetsBelongToApp(this.deps, input.appId, input.config);
    const hook = await uow.run(async () => {
      const found = await requireHook(hooks, input.appId, input.hookId);
      const now = clock.now();
      if (input.config) found.reconfigure(input.config, now);
      if (input.status) found.setStatus(input.status, now);
      await hooks.update(found);
      await outbox.append([auditEvent(found, INCOMING_HOOK_EVENTS.updated, ctx, { ...configOf(found), status: found.status })]);
      return found;
    });
    return describe(this.deps, hook);
  }
}

/** Đổi URL: token mới, token cũ hết hiệu lực NGAY. */
export class RotateIncomingHookToken {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; hookId: IncomingHookId }, ctx: CommandContext): Promise<IssuedHookUrlDto> {
    const { uow, outbox, clock, hooks, crypto } = this.deps;
    const token = crypto.issueToken();
    const hook = await uow.run(async () => {
      const found = await requireHook(hooks, input.appId, input.hookId);
      found.replaceToken(token, clock.now());
      await hooks.update(found);
      await outbox.append([auditEvent(found, INCOMING_HOOK_EVENTS.tokenRotated, ctx, { tokenHint: found.tokenHint })]);
      return found;
    });
    return issuedUrl(this.deps, hook, token.token);
  }
}

/** Xoá hook cùng nhật ký gọi. URL chết ngay; lần phát đã tạo không bị ảnh hưởng. */
export class DeleteIncomingHook {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; hookId: IncomingHookId }, ctx: CommandContext): Promise<void> {
    const { uow, outbox, hooks, calls } = this.deps;
    await uow.run(async () => {
      const hook = await requireHook(hooks, input.appId, input.hookId);
      await calls.deleteByHook(hook.id);
      await hooks.delete(hook.id);
      await outbox.append([auditEvent(hook, INCOMING_HOOK_EVENTS.deleted, ctx, { name: hook.name })]);
    });
  }
}
