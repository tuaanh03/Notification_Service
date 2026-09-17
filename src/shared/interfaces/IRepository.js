/**
 * Contract chung cho repository. Infrastructure sẽ implement.
 * JS không có interface -> dùng abstract class, method chưa implement thì throw.
 */
export class IRepository {
  async findById(_id) {
    throw new Error(`${this.constructor.name}.findById not implemented`);
  }

  async findAll(_filter = {}) {
    throw new Error(`${this.constructor.name}.findAll not implemented`);
  }

  async create(_entity) {
    throw new Error(`${this.constructor.name}.create not implemented`);
  }

  async update(_entity) {
    throw new Error(`${this.constructor.name}.update not implemented`);
  }

  async delete(_id) {
    throw new Error(`${this.constructor.name}.delete not implemented`);
  }
}
