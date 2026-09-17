import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * UC-007 điểm nhận theo kênh, opt-out theo topic, invalid
 */
export class Subscription extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
