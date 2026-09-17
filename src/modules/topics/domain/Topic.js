import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * UC-002 topic, binding, filter, pipeline giải người nhận
 */
export class Topic extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
