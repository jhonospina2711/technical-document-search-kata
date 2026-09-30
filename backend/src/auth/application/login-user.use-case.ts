import { Injectable } from '@nestjs/common';
import { InvalidCredentialsError } from '../domain/errors';
import { toPublicUser } from '../domain/user';
import { UserRepository } from '../domain/user.repository';
import { PasswordHasher, TokenService } from './ports';
import { Session } from './session';

export interface LoginUserCommand {
  email: string;
  password: string;
}

// Hash válido de una contraseña irrelevante: se compara cuando el correo no existe
// para que el tiempo de respuesta no revele si el usuario está registrado.
const TIMING_DUMMY_HASH = '$2b$10$TwLYr4uQHvyCi01cxrUc/OkQC7vSftIGrIuybtvl2aFP7ulsTddkS';

@Injectable()
export class LoginUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password }: LoginUserCommand): Promise<Session> {
    const user = await this.users.findByEmail(email);
    const passwordMatches = await this.hasher.compare(
      password,
      user?.passwordHash ?? TIMING_DUMMY_HASH,
    );
    if (!user || !passwordMatches || !user.isActive) {
      throw new InvalidCredentialsError();
    }
    return { user: toPublicUser(user), token: await this.tokens.sign(user.id) };
  }
}
