import { JwtService } from '@nestjs/jwt';
import { QueryFailedError, Repository } from 'typeorm';
import { EmailAlreadyRegisteredError, InvalidTokenError } from '../domain/errors';
import { BcryptPasswordHasher } from './bcrypt-password-hasher';
import { JwtTokenService } from './jwt-token.service';
import { TypeOrmUserRepository } from './typeorm-user.repository';
import { UserOrmEntity } from './user.orm-entity';

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  it('genera un hash con 10 rondas que solo valida la contraseña original', async () => {
    const hash = await hasher.hash('secret1');

    expect(hash).not.toContain('secret1');
    expect(hash.startsWith('$2b$10$') || hash.startsWith('$2a$10$')).toBe(true);
    await expect(hasher.compare('secret1', hash)).resolves.toBe(true);
    await expect(hasher.compare('otra', hash)).resolves.toBe(false);
  });
});

describe('JwtTokenService', () => {
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } });
  const service = new JwtTokenService(jwt);

  it('firma y verifica un token devolviendo el id del usuario', async () => {
    const token = await service.sign('user-1');

    await expect(service.verify(token)).resolves.toBe('user-1');
  });

  it('rechaza tokens mal formados, con otra firma o vencidos', async () => {
    const foreign = await new JwtService({ secret: 'otro' }).signAsync({ id: 'user-1' });
    const expired = await jwt.signAsync({ id: 'user-1' }, { expiresIn: '-10s' });

    for (const token of ['basura', foreign, expired]) {
      await expect(service.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
    }
  });

  it('rechaza un token firmado correctamente pero sin id', async () => {
    const token = await jwt.signAsync({ foo: 'bar' });

    await expect(service.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('TypeOrmUserRepository', () => {
  const row: UserOrmEntity = {
    id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    password: 'hashed',
    isActive: true,
    roles: ['user'],
    createdAt: new Date(),
  };
  const domainUser = {
    id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    passwordHash: 'hashed',
    isActive: true,
    roles: ['user'],
  };

  function setup() {
    const getOne = jest.fn();
    const where = jest.fn().mockReturnValue({ getOne });
    const orm = {
      createQueryBuilder: jest.fn().mockReturnValue({ where }),
      findOneBy: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(),
    };
    return { orm, where, getOne, repository: new TypeOrmUserRepository(orm as unknown as Repository<UserOrmEntity>) };
  }

  it('findByEmail compara sin distinguir mayúsculas y mapea a dominio', async () => {
    const { repository, where, getOne } = setup();
    getOne.mockResolvedValue(row);

    await expect(repository.findByEmail('Ada@Example.com')).resolves.toEqual(domainUser);
    expect(where).toHaveBeenCalledWith('lower(u.email) = lower(:email)', { email: 'Ada@Example.com' });
  });

  it('findByEmail y findById devuelven null si no existe', async () => {
    const { repository, getOne, orm } = setup();
    getOne.mockResolvedValue(null);
    orm.findOneBy.mockResolvedValue(null);

    await expect(repository.findByEmail('x@example.com')).resolves.toBeNull();
    await expect(repository.findById('nope')).resolves.toBeNull();
  });

  it('findById mapea a dominio', async () => {
    const { repository, orm } = setup();
    orm.findOneBy.mockResolvedValue(row);

    await expect(repository.findById('user-1')).resolves.toEqual(domainUser);
  });

  it('create guarda el hash en la columna password y devuelve el usuario de dominio', async () => {
    const { repository, orm } = setup();
    orm.save.mockResolvedValue(row);

    await expect(
      repository.create({ email: 'ada@example.com', name: 'Ada', passwordHash: 'hashed' }),
    ).resolves.toEqual(domainUser);
    expect(orm.create).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada', password: 'hashed' });
  });

  it('create traduce la violación de unicidad (23505) a EmailAlreadyRegisteredError', async () => {
    const { repository, orm } = setup();
    orm.save.mockRejectedValue(new QueryFailedError('INSERT', [], { code: '23505' } as never));

    await expect(
      repository.create({ email: 'ada@example.com', name: 'Ada', passwordHash: 'hashed' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('create propaga cualquier otro error', async () => {
    const { repository, orm } = setup();
    const failure = new Error('boom');
    orm.save.mockRejectedValue(failure);

    await expect(
      repository.create({ email: 'ada@example.com', name: 'Ada', passwordHash: 'hashed' }),
    ).rejects.toBe(failure);
  });
});
