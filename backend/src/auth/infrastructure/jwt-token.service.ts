import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../application/ports';
import { InvalidTokenError } from '../domain/errors';

interface JwtPayload {
  id?: unknown;
}

@Injectable()
export class JwtTokenService extends TokenService {
  constructor(private readonly jwt: JwtService) {
    super();
  }

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({ id: userId });
  }

  async verify(token: string): Promise<string> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new InvalidTokenError();
    }
    if (typeof payload.id !== 'string' || payload.id === '') {
      throw new InvalidTokenError();
    }
    return payload.id;
  }
}
