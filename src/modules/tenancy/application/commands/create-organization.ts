import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, OrgId, type AccountId, type Clock } from '../../../../shared/kernel/index.ts';
import { Organization } from '../../domain/entities/organization.ts';
import { toOrganizationDto, type OrganizationDto } from '../dto.ts';
import type { AccountRepository, OrganizationRepository } from '../ports/index.ts';

export class CreateOrganization {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    accounts: AccountRepository;
    organizations: OrganizationRepository;
  };

  constructor(deps: CreateOrganization['deps']) {
    this.deps = deps;
  }

  async execute(input: { accountId: AccountId; name: string }, ctx: CommandContext): Promise<OrganizationDto> {
    const { uow, outbox, clock, accounts, organizations } = this.deps;
    return uow.run(async () => {
      if (!(await accounts.findById(input.accountId))) throw new NotFoundError('account', input.accountId);
      const org = new Organization({ id: OrgId.create(), accountId: input.accountId, name: input.name, createdAt: clock.now() });
      await organizations.insert(org);
      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrganizationCreated',
          payload: audited(ctx, { after: { accountId: org.accountId, name: org.name } }),
        },
      ]);
      return toOrganizationDto(org);
    });
  }
}
