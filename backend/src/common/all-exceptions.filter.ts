import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from './request-id';

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  '57P01',
  '57P03',
  '08001',
  '08006',
]);

/** Respuestas de error uniformes; los errores no HTTP nunca exponen detalles internos. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const unavailable = isDatabaseUnavailable(exception);
    this.logger.error(
      `[${requestIdOf(request)}] ${unavailable ? 'base de datos no disponible' : 'error no controlado'}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    const statusCode = unavailable
      ? HttpStatus.SERVICE_UNAVAILABLE
      : HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(statusCode).json({
      statusCode,
      message: unavailable ? 'Servicio no disponible' : 'Error interno del servidor',
    });
  }
}

// pg no asigna código a las conexiones cortadas a mitad de consulta ni al agotar el pool.
const DB_UNAVAILABLE_MESSAGE = /Connection terminated|timeout exceeded when trying to connect/i;

function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Error && DB_UNAVAILABLE_MESSAGE.test(error.message)) {
    return true;
  }
  const candidates = [error, (error as { driverError?: unknown })?.driverError];
  return candidates.some((candidate) => {
    const code = (candidate as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' && DB_UNAVAILABLE_CODES.has(code);
  });
}
