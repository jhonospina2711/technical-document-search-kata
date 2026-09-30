import { Injectable } from '@nestjs/common';
import { PublicUser } from '../domain/user';
import { TokenService } from './ports';
import { Session } from './session';

/** Renueva el token de un usuario ya autenticado por `AuthGuard`. */
@Injectable()
export class RefreshSession {
  constructor(private readonly tokens: TokenService) {}

  async execute(user: PublicUser): Promise<Session> {
    return { user, token: await this.tokens.sign(user.id) };
  }
}
