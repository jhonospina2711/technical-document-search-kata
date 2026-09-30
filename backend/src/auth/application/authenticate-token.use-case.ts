import { Injectable } from '@nestjs/common';
import { InvalidTokenError } from '../domain/errors';
import { PublicUser, toPublicUser } from '../domain/user';
import { UserRepository } from '../domain/user.repository';
import { TokenService } from './ports';

/** Resuelve un JWT al usuario activo al que pertenece; lo usa `AuthGuard`. */
@Injectable()
export class AuthenticateToken {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
  ) {}

  async execute(token: string): Promise<PublicUser> {
    const userId = await this.tokens.verify(token);
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new InvalidTokenError();
    }
    return toPublicUser(user);
  }
}
