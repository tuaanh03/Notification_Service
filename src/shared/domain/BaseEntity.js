/**
 * Base cho mọi entity trong domain.
 * Chỉ giữ state + identity, không phụ thuộc framework/ORM.
 */
export class BaseEntity {
  constructor({ id = null, createdAt = new Date(), updatedAt = new Date() } = {}) {
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  touch() {
    this.updatedAt = new Date();
  }

  equals(other) {
    if (!other || !(other instanceof BaseEntity)) return false;
    return this.id !== null && this.id === other.id;
  }
}
