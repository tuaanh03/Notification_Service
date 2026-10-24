import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  NotFoundError,
  PersonalAccessTokenId,
  ValidationError,
  type AdminId,
  type Clock,
  type PatScope,
} from '../../../../shared/kernel/index.ts';
import { PersonalAccessToken } from '../../domain/entities/personal-access-token.ts';
import { toPersonalAccessTokenDto, type IssuedPersonalAccessTokenDto } from '../dto.ts';
import type {
  AdminRepository,
  PersonalAccessTokenFactory,
  PersonalAccessTokenPolicySource,
  PersonalAccessTokenRepository,
} from '../ports/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tạo PAT cho CHÍNH người đang đăng nhập (ADR-0044). Khoá dòng admin rồi mới đếm token còn hiệu lực (ADR-0009):
 * hai lần bấm song song không vượt được trần `pat.max_per_admin`. Hạn bắt buộc, ≤ `pat.max_lifetime_days`.
 */
export class CreatePersonalAccessToken {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    admins: AdminRepository;
    tokens: PersonalAccessTokenRepository;
    factory: PersonalAccessTokenFactory;
    policy: PersonalAccessTokenPolicySource;
  };

  constructor(deps: CreatePersonalAccessToken['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { adminId: AdminId; name: string; scope: PatScope; expiresInDays: number },
    ctx: CommandContext,
  ): Promise<IssuedPersonalAccessTokenDto> {
    const { uow, outbox, clock, admins, tokens, factory, policy } = this.deps;
    const limits = await policy.current();
    if (input.expiresInDays > limits.maxLifetimeDays) {
      throw ValidationError.of('PAT_LIFETIME_TOO_LONG', `expiresInDays must be at most ${limits.maxLifetimeDays}`, 'expiresInDays');
    }
    return uow.run(async () => {
      if (!(await admins.lockForUpdate(input.adminId))) throw new NotFoundError('admin', input.adminId);
      const now = clock.now();
      if ((await tokens.countActive(input.adminId, now)) >= limits.maxPerAdmin) {
        throw ValidationError.of('PAT_LIMIT_REACHED', `you already have ${limits.maxPerAdmin} active personal access tokens, revoke one first`);
      }
      const issued = factory.create();
      const token = new PersonalAccessToken({
        id: PersonalAccessTokenId.create(),
        adminId: input.adminId,
        name: input.name,
        tokenHash: issued.hash,
        hint: issued.hint,
        scope: input.scope,
        expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
        createdAt: now,
      });
      await tokens.insert(token);
      await outbox.append([
        {
          aggregateType: 'PersonalAccessToken',
          aggregateId: token.id,
          eventType: 'PersonalAccessTokenCreated',
          payload: audited(ctx, {
            after: { adminId: token.adminId, name: token.name, scope: token.scope, hint: token.hint, expiresAt: token.expiresAt.toISOString() },
          }),
        },
      ]);
      return { token: toPersonalAccessTokenDto(token, now), secret: issued.token };
    });
  }
}

/**
 * Thu hồi PAT. `ownerId` = chỉ thu hồi được token của chính người đó (token người khác -> 404, không xác nhận
 * nó tồn tại); `null` = Super Admin thu hồi bất kỳ (route đã kiểm `platform.manage`). Đã thu hồi -> không làm gì.
 */
export class RevokePersonalAccessToken {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; tokens: PersonalAccessTokenRepository };

  constructor(deps: RevokePersonalAccessToken['deps']) {
    this.deps = deps;
  }

  async execute(input: { tokenId: PersonalAccessTokenId; ownerId: AdminId | null }, ctx: CommandContext): Promise<void> {
    const { uow, outbox, clock, tokens } = this.deps;
    await uow.run(async () => {
      const token = await tokens.findById(input.tokenId);
      if (token === null || (input.ownerId !== null && token.adminId !== input.ownerId)) {
        throw new NotFoundError('personal access token', input.tokenId);
      }
      const now = clock.now();
      if (!token.revoke(now)) return;
      await tokens.updateRevoked(token);
      await outbox.append([
        {
          aggregateType: 'PersonalAccessToken',
          aggregateId: token.id,
          eventType: 'PersonalAccessTokenRevoked',
          payload: audited(ctx, { before: { status: 'active' }, after: { status: 'revoked', adminId: token.adminId, name: token.name } }),
        },
      ]);
    });
  }
}
