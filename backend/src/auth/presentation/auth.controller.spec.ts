import type { Request } from 'express';
import { LoginUser } from '../application/login-user.use-case';
import { RefreshSession } from '../application/refresh-session.use-case';
import { RegisterUser } from '../application/register-user.use-case';
import { AuthController } from './auth.controller';
import { AuthenticatedRequest } from './authenticated-request';

const user = { id: 'user-1', email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] };
const session = { user, token: 'jwt' };
const req = { headers: {} } as Request;

describe('AuthController', () => {
  const registerUser = { execute: jest.fn().mockResolvedValue(session) };
  const loginUser = { execute: jest.fn().mockResolvedValue(session) };
  const refreshSession = { execute: jest.fn().mockResolvedValue(session) };
  const controller = new AuthController(
    registerUser as unknown as RegisterUser,
    loginUser as unknown as LoginUser,
    refreshSession as unknown as RefreshSession,
  );

  it('register delega en el caso de uso', async () => {
    const dto = { email: 'ada@example.com', name: 'Ada', password: 'secret1' };

    await expect(controller.register(dto, req)).resolves.toBe(session);
    expect(registerUser.execute).toHaveBeenCalledWith(dto);
  });

  it('login delega en el caso de uso', async () => {
    const dto = { email: 'ada@example.com', password: 'secret1' };

    await expect(controller.login(dto, req)).resolves.toBe(session);
    expect(loginUser.execute).toHaveBeenCalledWith(dto);
  });

  it('check-token renueva la sesión del usuario autenticado', async () => {
    await expect(controller.checkToken({ user } as AuthenticatedRequest)).resolves.toBe(session);
    expect(refreshSession.execute).toHaveBeenCalledWith(user);
  });
});
