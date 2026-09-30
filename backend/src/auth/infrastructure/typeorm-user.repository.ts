import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { EmailAlreadyRegisteredError } from '../domain/errors';
import { User } from '../domain/user';
import { NewUser, UserRepository } from '../domain/user.repository';
import { UserOrmEntity } from './user.orm-entity';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class TypeOrmUserRepository extends UserRepository {
  constructor(@InjectRepository(UserOrmEntity) private readonly orm: Repository<UserOrmEntity>) {
    super();
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.orm
      .createQueryBuilder('u')
      .where('lower(u.email) = lower(:email)', { email })
      .getOne();
    return row && toDomain(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.orm.findOneBy({ id });
    return row && toDomain(row);
  }

  async create({ email, name, passwordHash }: NewUser): Promise<User> {
    try {
      const row = await this.orm.save(this.orm.create({ email, name, password: passwordHash }));
      return toDomain(row);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
      ) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }
}

function toDomain(row: UserOrmEntity): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password,
    isActive: row.isActive,
    roles: row.roles,
  };
}
