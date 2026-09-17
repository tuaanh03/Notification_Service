import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * UC-006 template, version, publish, schema biến, render
 */
export class Template extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
