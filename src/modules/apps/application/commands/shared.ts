import { NotFoundError, type AppId } from '../../../../shared/kernel/index.ts';
import type { App } from '../../domain/entities/app.ts';
import type { AppRepository } from '../ports/index.ts';

export async function requireApp(apps: AppRepository, id: AppId): Promise<App> {
  const app = await apps.findById(id);
  if (!app) throw new NotFoundError('app', id);
  return app;
}
