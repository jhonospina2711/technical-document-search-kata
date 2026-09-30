export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  abstract compare(plain: string, hash: string): Promise<boolean>;
}

export abstract class TokenService {
  abstract sign(userId: string): Promise<string>;
  /** Devuelve el id del usuario o lanza `InvalidTokenError`. */
  abstract verify(token: string): Promise<string>;
}
