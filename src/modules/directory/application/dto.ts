import type { User } from '../domain/entities/user.ts';
import type { UserEmailView } from './ports/index.ts';

/** User nhìn từ app service: định danh theo `externalId` của CHÍNH app đó (ADR-0016 D9). */
export interface UserDto {
  userId: string;
  externalId: string;
  createdAt: string;
  email: UserEmailView | null;
}

export const toUserDto = (user: User, email: UserEmailView | null): UserDto => ({
  userId: user.id,
  externalId: user.externalId ?? '',
  createdAt: user.createdAt.toISOString(),
  email,
});
