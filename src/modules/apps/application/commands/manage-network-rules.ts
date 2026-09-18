import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type NetworkRuleKind } from '../../../../shared/kernel/index.ts';
import { AppNetworkRule } from '../../domain/entities/app-network-rule.ts';
import { toNetworkRuleDto, type NetworkRuleDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository, NetworkRuleRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

type Deps = { uow: UnitOfWork; outbox: EventOutbox; apps: AppRepository; networkRules: NetworkRuleRepository };
type RuleInput = { appId: AppId; kind: NetworkRuleKind; value: string };

/** Thêm một dòng allowlist IP / Origin cho `/v1/*`. */
export class AddNetworkRule {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: RuleInput, ctx: CommandContext): Promise<NetworkRuleDto> {
    const { uow, outbox, apps, networkRules } = this.deps;
    return uow.run(async () => {
      await requireApp(apps, input.appId);
      const rule = new AppNetworkRule(input);
      await networkRules.insert(rule);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: input.appId,
          eventType: APP_EVENTS.networkRuleAdded,
          payload: audited(ctx, { after: { kind: rule.kind, value: rule.value } }),
        },
      ]);
      return toNetworkRuleDto(rule);
    });
  }
}

export class RemoveNetworkRule {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: RuleInput, ctx: CommandContext): Promise<void> {
    const { uow, outbox, apps, networkRules } = this.deps;
    await uow.run(async () => {
      await requireApp(apps, input.appId);
      if (!(await networkRules.remove(input.appId, input.kind, input.value.trim()))) {
        throw new NotFoundError('network rule', `${input.kind}:${input.value}`);
      }
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: input.appId,
          eventType: APP_EVENTS.networkRuleRemoved,
          payload: audited(ctx, { before: { kind: input.kind, value: input.value.trim() } }),
        },
      ]);
    });
  }
}
