import { BaseEntity } from '../../../shared/domain/index.js';

/**
 * UC-002 user, identity, tag, metric, import CSV, sync
 */
export class User extends BaseEntity {
  constructor({ id, email, name, tags = [], createdAt, updatedAt } = {}) {
    super({ id, createdAt, updatedAt });
    this.email = email;
    this.name = name;
    this.tags = tags;
  }

  rename(name) {
    if (!name || !name.trim()) {
      throw new Error('User name must not be empty');
    }
    this.name = name.trim();
    this.touch();
  }

  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.touch();
    }
  }
}
