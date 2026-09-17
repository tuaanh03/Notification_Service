import { IService, Result, EventId } from '../../../../shared/index.js';
import { User } from '../../domain/index.js';
import { CreateUserRequest, UserResponse } from '../dtos/index.js';

export class UserService extends IService {
  #userRepository;
  #logger;

  constructor({ userRepository, logger }) {
    super();
    this.#userRepository = userRepository;
    this.#logger = logger;
  }

  async create(input) {
    const request = new CreateUserRequest(input);
    const errors = request.validate();
    if (errors.length) {
      return Result.fail({ code: 'VALIDATION', message: errors.join(', ') });
    }

    const user = new User({
      id: EventId.generate(),
      email: request.email,
      name: request.name.trim(),
    });

    await this.#userRepository.create(user);
    this.#logger.info('user created', { id: user.id });

    return Result.ok(UserResponse.fromEntity(user));
  }

  async getById(id) {
    const user = await this.#userRepository.findById(id);
    if (!user) {
      return Result.fail({ code: 'NOT_FOUND', message: `User ${id} not found` });
    }
    return Result.ok(UserResponse.fromEntity(user));
  }
}
