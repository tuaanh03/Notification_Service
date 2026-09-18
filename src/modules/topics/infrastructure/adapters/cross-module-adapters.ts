import type { AppQueries } from '../../../apps/application/index.ts';
import type { FindUserByExternalId } from '../../../directory/application/index.ts';
import type { SetOptedOutOptional } from '../../../subscriptions/application/index.ts';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { NotFoundError, UserId, type AppId } from '../../../../shared/kernel/index.ts';
import type { AppLookup, OptionalEmailSetting, UserEmailSummary, UserLookup } from '../../application/ports/index.ts';

/** topics -> apps (query công khai). */
export class AppsAppLookup implements AppLookup {
  private readonly queries: AppQueries;

  constructor(deps: { appQueries: AppQueries }) {
    this.queries = deps.appQueries;
  }

  async exists(appId: AppId): Promise<boolean> {
    try {
      await this.queries.get(appId);
      return true;
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
  }
}

/** topics -> directory (query công khai). */
export class DirectoryUserLookup implements UserLookup {
  private readonly findUser: FindUserByExternalId;

  constructor(deps: { findUser: FindUserByExternalId }) {
    this.findUser = deps.findUser;
  }

  async find(input: { appId: AppId; externalId: string }): Promise<{ userId: UserId; email: UserEmailSummary | null } | null> {
    const user = await this.findUser.find(input);
    if (!user) return null;
    return {
      userId: UserId.parse(user.userId),
      email: user.email ? { status: user.email.status, optedOutOptional: user.email.optedOutOptional } : null,
    };
  }
}

/** topics -> subscriptions (use case công khai). */
export class SubscriptionsOptionalEmailSetting implements OptionalEmailSetting {
  private readonly setOptedOutOptional: SetOptedOutOptional;

  constructor(deps: { setOptedOutOptional: SetOptedOutOptional }) {
    this.setOptedOutOptional = deps.setOptedOutOptional;
  }

  async set(input: { appId: AppId; userId: UserId; optedOut: boolean }, ctx: CommandContext): Promise<void> {
    await this.setOptedOutOptional.execute(input, ctx);
  }
}
