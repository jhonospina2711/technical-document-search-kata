import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticateToken } from '../application/authenticate-token.use-case';
import { InvalidTokenError } from '../domain/errors';
import { AuthGuard } from './auth.guard';

const user = { id: 'user-1', email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] };

function contextWith(headers: Record<string, string>) {
  const request: Record<string, unknown> = { headers };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  return { context, request };
}

describe('AuthGuard', () => {
  const authenticate = jest.fn();
  const guard = new AuthGuard({ execute: authenticate } as unknown as AuthenticateToken);

  beforeEach(() => authenticate.mockReset());

  it('deja pasar y expone request.user con un Bearer válido', async () => {
    authenticate.mockResolvedValue(user);
    const { context, request } = contextWith({ authorization: 'Bearer abc' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('abc');
    expect(request.user).toEqual(user);
  });

  it.each([
    ['sin cabecera', {}],
    ['esquema distinto de Bearer', { authorization: 'Basic abc' }],
    ['Bearer sin token', { authorization: 'Bearer' }],
  ])('responde 401 %s', async (_name, headers) => {
    const { context } = contextWith(headers);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('responde 401 si el token es inválido, vencido o el usuario no está activo', async () => {
    authenticate.mockRejectedValue(new InvalidTokenError());
    const { context } = contextWith({ authorization: 'Bearer abc' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('no oculta fallos de infraestructura como 401', async () => {
    const failure = new Error('db down');
    authenticate.mockRejectedValue(failure);
    const { context } = contextWith({ authorization: 'Bearer abc' });

    await expect(guard.canActivate(context)).rejects.toBe(failure);
  });
});
