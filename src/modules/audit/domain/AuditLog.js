import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * append-only; subscribe mọi domain event; /admin/audit
 */
export class AuditLog extends BaseEntity {
  constructor({ id, createdAt, updatedAt, ...props } = {}) {
    super({ id, createdAt, updatedAt });
    Object.assign(this, props);
  }
}
