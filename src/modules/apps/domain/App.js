import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * UC-001 app, secret (hash+hint), allowlist, quota, duyệt app
 */
export class App extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
