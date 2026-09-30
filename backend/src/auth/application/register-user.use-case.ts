import { Injectable } from '@nestjs/common';
import { EmailAlreadyRegisteredError } from '../domain/errors';
import { toPublicUser } from '../domain/user';
import { UserRepository } from '../domain/user.repository';
import { PasswordHasher, TokenService } from './ports';
import { Session } from './session';

export interface RegisterUserCommand {
  email: string;
  name: string;
  password: string;
}

@Injectable()
export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, name, password }: RegisterUserCommand): Promise<Session> {
    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredError();
    }
    const user = await this.users.create({
      email,
      name,
      passwordHash: await this.hasher.hash(password),
    });
    return { user: toPublicUser(user), token: await this.tokens.sign(user.id) };
  }
}
