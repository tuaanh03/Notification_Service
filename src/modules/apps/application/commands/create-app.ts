import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { AppId, NotFoundError, type AppOrigin, type Clock, type OrgId } from '../../../../shared/kernel/index.ts';
import { App } from '../../domain/entities/app.ts';
import { toAppDto, type AppDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository, OrganizationLookup } from '../ports/index.ts';

export interface CreateAppInput {
  orgId: OrgId;
  slug: string;
  name: string;
  namespace: string;
  origin?: AppOrigin | undefined;
}

/** UC-001: đăng ký app mới ở trạng thái `draft`. Chưa gửi được gì cho tới khi được duyệt. */
export class CreateApp {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    apps: AppRepository;
    organizations: OrganizationLookup;
  };

  constructor(deps: CreateApp['deps']) {
    this.deps = deps;
  }

  async execute(input: CreateAppInput, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps, organizations } = this.deps;
    return uow.run(async () => {
      const owner = await organizations.findOwner(input.orgId);
      if (!owner) throw new NotFoundError('organization', input.orgId);

      const app = new App({
        id: AppId.create(),
        orgId: owner.orgId,
        accountId: owner.accountId,
        slug: input.slug,
        name: input.name,
        namespace: input.namespace,
        origin: input.origin,
        createdAt: clock.now(),
      });
      await apps.insert(app);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.created,
          payload: audited(ctx, {
            after: { orgId: app.orgId, slug: app.slug, name: app.name, namespace: app.namespace, status: app.status },
          }),
        },
      ]);
      return toAppDto(app);
    });
  }
}
