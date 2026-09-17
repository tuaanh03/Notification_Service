export class CreateUserRequest {
  constructor({ email, name } = {}) {
    this.email = email;
    this.name = name;
  }

  validate() {
    const errors = [];
    if (!this.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      errors.push('email is invalid');
    }
    if (!this.name || !this.name.trim()) {
      errors.push('name is required');
    }
    return errors;
  }
}

export class UserResponse {
  constructor({ id, email, name, tags, createdAt }) {
    this.id = id;
    this.email = email;
    this.name = name;
    this.tags = tags;
    this.createdAt = createdAt;
  }

  static fromEntity(user) {
    return new UserResponse(user);
  }
}
