export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isActive: boolean;
  roles: string[];
}

/** Usuario sin datos sensibles: es lo único que sale de la capa de aplicación. */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser({ passwordHash: _omitted, ...user }: User): PublicUser {
  return user;
}
