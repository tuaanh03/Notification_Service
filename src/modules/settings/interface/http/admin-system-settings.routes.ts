import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminCaller, adminContext, doc, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
import type { SystemSettingsQueries, UpdateSystemSettings } from '../../application/index.ts';

const updateBody = z.object({ values: z.record(z.string(), z.unknown()) }).strict();

/** Cài đặt hệ thống — chỉ Super Admin (`platform.manage`, ADR-0030). */
export function adminSystemSettingsRoutes(useCases: { queries: SystemSettingsQueries; update: UpdateSystemSettings }): HttpRoutes {
  return (app) => {
    const tag = 'system-settings';

    app.get(
      '/system-settings',
      {
        config: {
          ...access('platform.manage'),
          ...doc({ tag, summary: 'List every system setting with its current value, default and allowed range.', responseDto: '{ settings: SystemSettingDto[] }' }),
        },
      },
      async () => ({ settings: await useCases.queries.list() }),
    );

    app.put(
      '/system-settings',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Change some system settings; `null` resets a setting to its default.',
            description:
              'Send only the keys to change. Every key is validated first: one invalid key and nothing is saved. New values reach every API server within 30 seconds.',
            body: updateBody,
            example: { values: { 'apps.max_active_api_keys': 10 } },
            responseDto: '{ settings: SystemSettingDto[] }',
            errors: [
              { status: 422, code: 'SETTINGS_EMPTY' },
              { status: 422, code: 'SETTING_UNKNOWN' },
              { status: 422, code: 'SETTING_OUT_OF_RANGE' },
              { status: 422, code: 'SETTING_INVALID_BOOLEAN' },
              { status: 422, code: 'SETTING_INVALID_URL' },
            ],
          }),
        },
      },
      async (request) => {
        const body = parseInput(updateBody, request.body);
        const ctx: CommandContext = adminContext(request);
        return { settings: await useCases.update.execute({ values: body.values }, ctx) };
      },
    );
  };
}
