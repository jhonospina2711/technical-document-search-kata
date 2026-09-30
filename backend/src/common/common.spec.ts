import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { requestIdMiddleware, requestIdOf } from './request-id';

function hostWithResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('respeta las HttpException', () => {
    const { host, status, json } = hostWithResponse();
    const exception = new BadRequestException('mal');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(exception.getResponse());
  });

  it('oculta el detalle de errores inesperados (500)', () => {
    const { host, status, json } = hostWithResponse();

    filter.catch(new Error('select * from users: relation missing'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Error interno del servidor' });
  });

  it.each([
    ['código de red', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })],
    ['conexión cortada sin código', new Error('Connection terminated unexpectedly')],
    ['código de postgres en driverError', Object.assign(new Error('x'), { driverError: { code: '57P01' } })],
  ])('responde 503 si la base de datos no está disponible (%s)', (_name, error) => {
    const { host, status, json } = hostWithResponse();

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ statusCode: 503, message: 'Servicio no disponible' });
  });

  it('tolera excepciones que no son Error', () => {
    const { host, status } = hostWithResponse();

    filter.catch('texto', host);

    expect(status).toHaveBeenCalledWith(500);
  });
});

describe('requestIdMiddleware', () => {
  it('asigna un id propio, ignorando el que envíe el cliente', () => {
    const req = { headers: { 'x-request-id': 'inyectado\nlinea-falsa' } } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;
    const next: NextFunction = jest.fn();

    requestIdMiddleware(req, res, next);

    const id = requestIdOf(req);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', id);
    expect(next).toHaveBeenCalled();
  });

  it('requestIdOf devuelve "-" si no hay id', () => {
    expect(requestIdOf({ headers: {} } as Request)).toBe('-');
  });
});
