import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { AccountId, type Clock } from '../../../../shared/kernel/index.ts';
import { Account } from '../../domain/entities/account.ts';
import { toAccountDto, type AccountDto } from '../dto.ts';
import type { AccountRepository } from '../ports/index.ts';

export class CreateAccount {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; accounts: AccountRepository };

  constructor(deps: CreateAccount['deps']) {
    this.deps = deps;
  }

  async execute(input: { name: string }, ctx: CommandContext): Promise<AccountDto> {
    const { uow, outbox, clock, accounts } = this.deps;
    return uow.run(async () => {
      const account = new Account({ id: AccountId.create(), name: input.name, createdAt: clock.now() });
      await accounts.insert(account);
      await outbox.append([
        {
          aggregateType: 'Account',
          aggregateId: account.id,
          eventType: 'AccountCreated',
          payload: audited(ctx, { after: { name: account.name } }),
        },
      ]);
      return toAccountDto(account);
    });
  }
}
