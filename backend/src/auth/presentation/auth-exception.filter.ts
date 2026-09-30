import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from '../../common/request-id';
import { EmailAlreadyRegisteredError, InvalidCredentialsError } from '../domain/errors';

/** Traduce los errores de dominio de auth a respuestas HTTP con mensajes genéricos. */
@Catch(EmailAlreadyRegisteredError, InvalidCredentialsError)
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Auth');

  catch(error: EmailAlreadyRegisteredError | InvalidCredentialsError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const exception =
      error instanceof EmailAlreadyRegisteredError
        ? new BadRequestException('El correo ya está registrado')
        : new UnauthorizedException('Credenciales inválidas');

    this.logger.warn(
      `[${requestIdOf(request)}] ${error instanceof InvalidCredentialsError ? 'login fallido' : 'registro con correo duplicado'}`,
    );
    http.getResponse<Response>().status(exception.getStatus()).json(exception.getResponse());
  }
}
