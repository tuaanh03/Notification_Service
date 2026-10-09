import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AdminId, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AdminAppRoleRepository, AppRepository } from '../ports/index.ts';

/** Thu hồi vai App Admin / App Viewer của một người trên một app (ADR-0026). Khoá dòng app trước. */
export class RevokeAppRole {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    apps: AppRepository;
    roles: AdminAppRoleRepository;
  };

  constructor(deps: RevokeAppRole['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; adminId: AdminId }, ctx: CommandContext): Promise<void> {
    const { uow, outbox, clock, apps, roles } = this.deps;
    await uow.run(async () => {
      if (!(await apps.lockForUpdate(input.appId))) throw new NotFoundError('app', input.appId);
      if (!(await roles.revoke(input.adminId, input.appId, clock.now()))) throw new NotFoundError('app role', input.adminId);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: input.appId,
          eventType: APP_EVENTS.roleRevoked,
          payload: audited(ctx, { before: { adminId: input.adminId }, after: { adminId: input.adminId, role: null } }),
        },
      ]);
    });
  }
}
