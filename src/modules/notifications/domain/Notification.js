import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * UC-005/008 aggregate + state machine + recipients + duyệt
 */
export class Notification extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
