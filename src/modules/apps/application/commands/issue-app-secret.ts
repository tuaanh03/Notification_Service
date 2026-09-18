import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { AppSecret } from '../../domain/entities/app-secret.ts';
import { toAppSecretDto, type IssuedAppSecretDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { ApiKeyService, AppRepository, AppSecretRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

/**
 * Cấp API key mới (cũng là cách "xoay vòng": cấp key mới, chuyển app service sang, rồi thu hồi key cũ).
 *
 * "Tối đa 2 key active" KHÔNG ép được ở MySQL (ADR-0009): khoá dòng `apps` TRƯỚC khi đếm, để hai
 * lệnh cấp song song xếp hàng thay vì cùng đếm ra 1 rồi cùng INSERT.
 * Plaintext chỉ nằm trong response này — không vào DB, không vào event, không vào log.
 */
export class IssueAppSecret {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    apps: AppRepository;
    secrets: AppSecretRepository;
    apiKeys: ApiKeyService;
  };

  constructor(deps: IssueAppSecret['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId }, ctx: CommandContext): Promise<IssuedAppSecretDto> {
    const { uow, outbox, clock, apps, secrets, apiKeys } = this.deps;
    return uow.run(async () => {
      if (!(await apps.lockForUpdate(input.appId))) throw new NotFoundError('app', input.appId);
      const app = await requireApp(apps, input.appId);
      app.assertAcceptsNewSecret();
      AppSecret.assertCanAddActive(await secrets.countActive(app.id));

      const issued = apiKeys.issue();
      const secret = new AppSecret({
        id: issued.secretId,
        appId: app.id,
        secretHash: issued.secretHash,
        hint: issued.hint,
        createdAt: clock.now(),
      });
      await secrets.insert(secret);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.secretIssued,
          payload: audited(ctx, { after: { secretId: secret.id, hint: secret.hint } }),
        },
      ]);
      return { ...toAppSecretDto(secret), apiKey: issued.apiKey };
    });
  }
}
