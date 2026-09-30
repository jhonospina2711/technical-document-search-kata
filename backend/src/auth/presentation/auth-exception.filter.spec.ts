import { ArgumentsHost } from '@nestjs/common';
import { EmailAlreadyRegisteredError, InvalidCredentialsError } from '../domain/errors';
import { AuthExceptionFilter } from './auth-exception.filter';

function hostWithResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AuthExceptionFilter', () => {
  const filter = new AuthExceptionFilter();

  it('traduce correo duplicado a 400', () => {
    const { host, status, json } = hostWithResponse();

    filter.catch(new EmailAlreadyRegisteredError(), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'El correo ya está registrado' }));
  });

  it('traduce credenciales inválidas a 401 con un mensaje genérico', () => {
    const { host, status, json } = hostWithResponse();

    filter.catch(new InvalidCredentialsError(), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Credenciales inválidas' }));
  });
});
