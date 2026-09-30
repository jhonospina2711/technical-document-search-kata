import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from '../../common/request-id';
import { EmptyFileError, UnsupportedFileFormatError } from '../domain/errors';

/** Traduce los errores de dominio de la carga a `400` con un mensaje claro. */
@Catch(UnsupportedFileFormatError, EmptyFileError)
export class DocumentsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Documents');

  catch(error: UnsupportedFileFormatError | EmptyFileError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    this.logger.warn(`[${requestIdOf(http.getRequest<Request>())}] carga rechazada: ${error.constructor.name}`);
    const exception = new BadRequestException(error.message);
    http.getResponse<Response>().status(exception.getStatus()).json(exception.getResponse());
  }
}
