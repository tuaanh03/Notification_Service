import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * adapter kênh: email (Exchange), in_app; chia lô; bounce
 */
export class Delivery extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
