import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import type { SystemSettingsQueries, UpdateSystemSettings } from '../../application/index.ts';

const updateBody = z.object({ values: z.record(z.string(), z.unknown()) }).strict();

/** Cài đặt hệ thống — chỉ Super Admin (`platform.manage`, ADR-0030). */
export function adminSystemSettingsRoutes(useCases: { queries: SystemSettingsQueries; update: UpdateSystemSettings }): HttpRoutes {
  return (app) => {
    app.get('/system-settings', { config: access('platform.manage') }, async () => ({ settings: await useCases.queries.list() }));

    app.put('/system-settings', { config: access('platform.manage') }, async (request) => {
      const body = parseInput(updateBody, request.body);
      const ctx: CommandContext = { actor: { id: adminCaller(request).adminId, type: 'admin' }, source: 'admin_api' };
      return { settings: await useCases.update.execute({ values: body.values }, ctx) };
    });
  };
}
