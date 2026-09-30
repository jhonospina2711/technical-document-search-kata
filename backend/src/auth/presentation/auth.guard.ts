import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticateToken } from '../application/authenticate-token.use-case';
import { requestIdOf } from '../../common/request-id';
import { InvalidTokenError } from '../domain/errors';
import { AuthenticatedRequest } from './authenticated-request';

/** Exige `Authorization: Bearer <jwt>` de un usuario activo y lo deja en `request.user`. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly authenticateToken: AuthenticateToken) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      request.user = await this.authenticateToken.execute(token);
    } catch (error) {
      if (!(error instanceof InvalidTokenError)) {
        throw error;
      }
      this.logger.warn(`[${requestIdOf(request)}] token rechazado`);
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? token : undefined;
  }
}
