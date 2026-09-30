import { randomUUID } from 'node:crypto';
import { EmailAlreadyRegisteredError } from '../../src/auth/domain/errors';
import { User } from '../../src/auth/domain/user';
import { NewUser, UserRepository } from '../../src/auth/domain/user.repository';

/** Sustituto de PostgreSQL para la prueba de integración del flujo de auth. */
export class InMemoryUserRepository extends UserRepository {
  readonly users = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    return [...this.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create({ email, name, passwordHash }: NewUser): Promise<User> {
    if (await this.findByEmail(email)) {
      throw new EmailAlreadyRegisteredError();
    }
    const user: User = { id: randomUUID(), email, name, passwordHash, isActive: true, roles: ['user'] };
    this.users.set(user.id, user);
    return user;
  }
}
