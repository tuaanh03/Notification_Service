import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type AppSecretId, type Clock } from '../../../../shared/kernel/index.ts';
import { toAppSecretDto, type AppSecretDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository, AppSecretRepository } from '../ports/index.ts';

/** Thu hồi một key. Gọi lại trên key đã thu hồi là no-op (không lỗi, không event trùng). */
export class RevokeAppSecret {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    apps: AppRepository;
    secrets: AppSecretRepository;
  };

  constructor(deps: RevokeAppSecret['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; secretId: AppSecretId }, ctx: CommandContext): Promise<AppSecretDto> {
    const { uow, outbox, clock, apps, secrets } = this.deps;
    return uow.run(async () => {
      if (!(await apps.lockForUpdate(input.appId))) throw new NotFoundError('app', input.appId);
      const secret = await secrets.findById(input.secretId);
      // Key của app khác cũng trả 404: không để lộ rằng id đó tồn tại.
      if (!secret || secret.appId !== input.appId) throw new NotFoundError('app secret', input.secretId);
      if (secret.status === 'revoked') return toAppSecretDto(secret);

      secret.revoke(clock.now());
      await secrets.update(secret);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: input.appId,
          eventType: APP_EVENTS.secretRevoked,
          payload: audited(ctx, { before: { secretId: secret.id, status: 'active' }, after: { status: 'revoked' } }),
        },
      ]);
      return toAppSecretDto(secret);
    });
  }
}
