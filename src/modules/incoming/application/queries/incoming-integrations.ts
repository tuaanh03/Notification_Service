import { INCOMING_INTEGRATIONS } from '../../domain/rules/integrations.ts';
import { toIncomingIntegrationDto, type IncomingIntegrationDto } from '../dto.ts';

/** Danh mục công cụ giám sát (ADR-0046) — viết trong code, không thuộc app / org nào. */
export class IncomingIntegrationQueries {
  list(): { integrations: IncomingIntegrationDto[] } {
    return { integrations: INCOMING_INTEGRATIONS.map(toIncomingIntegrationDto) };
  }
}
