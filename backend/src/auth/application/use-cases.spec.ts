import { EmailAlreadyRegisteredError, InvalidCredentialsError, InvalidTokenError } from '../domain/errors';
import { User } from '../domain/user';
import { UserRepository } from '../domain/user.repository';
import { AuthenticateToken } from './authenticate-token.use-case';
import { LoginUser } from './login-user.use-case';
import { PasswordHasher, TokenService } from './ports';
import { RefreshSession } from './refresh-session.use-case';
import { RegisterUser } from './register-user.use-case';

const storedUser: User = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  passwordHash: 'hashed',
  isActive: true,
  roles: ['user'],
};

function setup() {
  const users = {
    findByEmail: jest.fn<Promise<User | null>, [string]>().mockResolvedValue(null),
    findById: jest.fn<Promise<User | null>, [string]>().mockResolvedValue(storedUser),
    create: jest.fn().mockResolvedValue(storedUser),
  } satisfies UserRepository;
  const hasher = {
    hash: jest.fn().mockResolvedValue('hashed'),
    compare: jest.fn().mockResolvedValue(true),
  } satisfies PasswordHasher;
  const tokens = {
    sign: jest.fn().mockResolvedValue('jwt'),
    verify: jest.fn().mockResolvedValue('user-1'),
  } satisfies TokenService;
  return { users, hasher, tokens };
}

describe('RegisterUser', () => {
  it('crea el usuario con la contraseña hasheada y devuelve sesión sin password', async () => {
    const { users, hasher, tokens } = setup();
    const result = await new RegisterUser(users, hasher, tokens).execute({
      email: 'ada@example.com',
      name: 'Ada',
      password: 'secret1',
    });

    expect(hasher.hash).toHaveBeenCalledWith('secret1');
    expect(users.create).toHaveBeenCalledWith({
      email: 'ada@example.com',
      name: 'Ada',
      passwordHash: 'hashed',
    });
    expect(result.token).toBe('jwt');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.id).toBe('user-1');
  });

  it('rechaza un correo ya registrado', async () => {
    const { users, hasher, tokens } = setup();
    users.findByEmail.mockResolvedValue(storedUser);

    await expect(
      new RegisterUser(users, hasher, tokens).execute({ email: 'ada@example.com', name: 'Ada', password: 'secret1' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    expect(users.create).not.toHaveBeenCalled();
  });
});

describe('LoginUser', () => {
  const command = { email: 'ada@example.com', password: 'secret1' };

  it('devuelve sesión con credenciales correctas', async () => {
    const { users, hasher, tokens } = setup();
    users.findByEmail.mockResolvedValue(storedUser);

    const result = await new LoginUser(users, hasher, tokens).execute(command);

    expect(hasher.compare).toHaveBeenCalledWith('secret1', 'hashed');
    expect(result.token).toBe('jwt');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('falla con correo inexistente y aun así compara contra un hash señuelo', async () => {
    const { users, hasher, tokens } = setup();
    hasher.compare.mockResolvedValue(false);

    await expect(new LoginUser(users, hasher, tokens).execute(command)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(hasher.compare).toHaveBeenCalledTimes(1);
  });

  it('falla con contraseña incorrecta', async () => {
    const { users, hasher, tokens } = setup();
    users.findByEmail.mockResolvedValue(storedUser);
    hasher.compare.mockResolvedValue(false);

    await expect(new LoginUser(users, hasher, tokens).execute(command)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('falla con usuario inactivo usando el mismo error', async () => {
    const { users, hasher, tokens } = setup();
    users.findByEmail.mockResolvedValue({ ...storedUser, isActive: false });

    await expect(new LoginUser(users, hasher, tokens).execute(command)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(tokens.sign).not.toHaveBeenCalled();
  });
});

describe('AuthenticateToken', () => {
  it('devuelve el usuario público si el token es válido y el usuario está activo', async () => {
    const { users, tokens } = setup();
    const user = await new AuthenticateToken(users, tokens).execute('jwt');

    expect(users.findById).toHaveBeenCalledWith('user-1');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('propaga el error de un token inválido', async () => {
    const { users, tokens } = setup();
    tokens.verify.mockRejectedValue(new InvalidTokenError());

    await expect(new AuthenticateToken(users, tokens).execute('bad')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rechaza si el usuario ya no existe', async () => {
    const { users, tokens } = setup();
    users.findById.mockResolvedValue(null);

    await expect(new AuthenticateToken(users, tokens).execute('jwt')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rechaza si el usuario fue desactivado', async () => {
    const { users, tokens } = setup();
    users.findById.mockResolvedValue({ ...storedUser, isActive: false });

    await expect(new AuthenticateToken(users, tokens).execute('jwt')).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('RefreshSession', () => {
  it('emite un token nuevo para el usuario autenticado', async () => {
    const { tokens } = setup();
    const user = { id: 'user-1', email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] };

    await expect(new RefreshSession(tokens).execute(user)).resolves.toEqual({ user, token: 'jwt' });
    expect(tokens.sign).toHaveBeenCalledWith('user-1');
  });
});
