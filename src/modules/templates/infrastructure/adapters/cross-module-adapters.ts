import type { AppQueries } from '../../../apps/application/index.ts';
import { NotFoundError, type AppId } from '../../../../shared/kernel/index.ts';
import type { AppLookup } from '../../application/ports/index.ts';

/** templates -> apps (query công khai). */
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
