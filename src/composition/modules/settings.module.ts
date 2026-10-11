import { SystemSettingsQueries, UpdateSystemSettings } from '../../modules/settings/application/index.ts';
import { DrizzleSystemSettingRepository } from '../../modules/settings/infrastructure/adapters/index.ts';
import { adminSystemSettingsRoutes } from '../../modules/settings/interface/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module settings — Cài đặt hệ thống do Super Admin chỉnh (ADR-0030). Chỉ process api có route. */
export function settingsModule(container: Container): { definition: ModuleDefinition; systemSettings: SystemSettingsQueries } {
  const { uow, outbox, clock } = container.ports;
  const settings = new DrizzleSystemSettingRepository({ transactions: container.infra.transactions });
  const queries = new SystemSettingsQueries({ settings, clock });
  return {
    systemSettings: queries,
    definition: {
      name: 'settings',
      http: { admin: [adminSystemSettingsRoutes({ queries, update: new UpdateSystemSettings({ uow, outbox, clock, settings, queries }) })] },
    },
  };
}
