import { User } from './user';

export type NewUser = Pick<User, 'email' | 'name' | 'passwordHash'>;

/**
 * Puerto de persistencia. `create` lanza `EmailAlreadyRegisteredError`
 * si el correo ya existe (sin distinguir mayúsculas).
 */
export abstract class UserRepository {
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findById(id: string): Promise<User | null>;
  abstract create(newUser: NewUser): Promise<User>;
}
