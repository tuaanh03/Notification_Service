import { randomUUID } from 'node:crypto';

/**
 * Sinh id cho entity / event / correlation.
 */
export const EventId = {
  generate: () => randomUUID(),
};
