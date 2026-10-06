import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { ConflictError, NotFoundError, type AppId, type AppRole, type Clock } from '../../../../shared/kernel/index.ts';
import { AdminAppRole } from '../../domain/entities/admin-app-role.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AdminAppRoleRepository, AppRepository, MembershipLookup } from '../ports/index.ts';
import { requireApp } from './shared.ts';

/**
 * Cấp vai App Admin / App Viewer cho một người (ADR-0022). Người đó PHẢI là thành viên của org sở
 * hữu app — MySQL không ép được (vai org nằm ở bảng khác, module khác) nên ép ở đây.
 * Khoá dòng app trước: hai lệnh cấp cho cùng người + app chạy song song không ghi lẫn nhau.
 */
export class GrantAppRole {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    apps: AppRepository;
    roles: AdminAppRoleRepository;
    memberships: MembershipLookup;
  };

  constructor(deps: GrantAppRole['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; email: string; role: AppRole },
    ctx: CommandContext,
  ): Promise<{ appId: string; adminId: string; email: string; role: AppRole }> {
    const { uow, outbox, clock, apps, roles, memberships } = this.deps;
    return uow.run(async () => {
      if (!(await apps.lockForUpdate(input.appId))) throw new NotFoundError('app', input.appId);
      const app = await requireApp(apps, input.appId);
      const admin = await memberships.adminByEmail(input.email);
      if (admin === null) throw new NotFoundError('admin', input.email);
      if ((await memberships.roleIn(app.orgId, admin.id)) === null) {
        throw new ConflictError('NOT_ORG_MEMBER', 'app roles can only be granted to members of the app organization');
      }

      await roles.save(AdminAppRole.grant(admin, app, input.role, clock.now()));
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.roleGranted,
          payload: audited(ctx, { after: { adminId: admin.id, role: input.role } }),
        },
      ]);
      return { appId: app.id, adminId: admin.id, email: admin.email, role: input.role };
    });
  }
}
