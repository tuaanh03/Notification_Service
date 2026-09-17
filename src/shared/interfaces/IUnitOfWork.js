/**
 * Gom nhiều thao tác repository vào 1 transaction.
 */
export class IUnitOfWork {
  async begin() {
    throw new Error(`${this.constructor.name}.begin not implemented`);
  }

  async commit() {
    throw new Error(`${this.constructor.name}.commit not implemented`);
  }

  async rollback() {
    throw new Error(`${this.constructor.name}.rollback not implemented`);
  }

  /**
   * Chạy `work(uow)` trong transaction, tự commit / rollback.
   */
  async execute(work) {
    await this.begin();
    try {
      const result = await work(this);
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback();
      throw err;
    }
  }
}
