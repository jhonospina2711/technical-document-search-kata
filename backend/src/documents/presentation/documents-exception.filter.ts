import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { requestIdOf } from '../../common/request-id';
import {
  EmptyFileError,
  InvalidFileContentError,
  InvalidFileNameError,
  UnsupportedFileFormatError,
} from '../domain/errors';

type UploadDomainError =
  | UnsupportedFileFormatError
  | EmptyFileError
  | InvalidFileContentError
  | InvalidFileNameError;

// Multer no expone mensajes estables entre versiones ("Unexpected field" → "Unexpected file field").
const MULTER_FILE_COUNT_MESSAGE = /^(Too many files|Unexpected (file )?field)/i;

/**
 * Traduce a mensajes claros en español los rechazos de la carga: errores de dominio (`400`) y
 * errores de multer (`413` por tamaño, `400` por más de un archivo o campo inesperado).
 * Cualquier otra `HttpException` (p. ej. validación del DTO) se devuelve tal cual.
 */
@Catch(
  UnsupportedFileFormatError,
  EmptyFileError,
  InvalidFileContentError,
  InvalidFileNameError,
  PayloadTooLargeException,
  BadRequestException,
)
export class DocumentsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Documents');

  constructor(private readonly config: ConfigService) {}

  catch(error: UploadDomainError | HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    this.logger.warn(`[${requestIdOf(http.getRequest<Request>())}] carga rechazada: ${error.constructor.name}`);
    const exception = this.toHttpException(error);
    http.getResponse<Response>().status(exception.getStatus()).json(exception.getResponse());
  }

  private toHttpException(error: UploadDomainError | HttpException): HttpException {
    if (error instanceof PayloadTooLargeException) {
      const limit = formatBytes(this.config.getOrThrow<number>('UPLOAD_MAX_FILE_SIZE_BYTES'));
      return new PayloadTooLargeException(`El archivo supera el tamaño máximo permitido (${limit})`);
    }
    if (error instanceof BadRequestException) {
      return MULTER_FILE_COUNT_MESSAGE.test(error.message)
        ? new BadRequestException('Solo se admite un archivo en el campo "file"')
        : error;
    }
    return new BadRequestException(error.message);
  }
}

function formatBytes(bytes: number): string {
  const units: [string, number][] = [
    ['MB', 1024 * 1024],
    ['KB', 1024],
  ];
  for (const [unit, size] of units) {
    if (bytes >= size) {
      return `${Number((bytes / size).toFixed(1))} ${unit}`;
    }
  }
  return `${bytes} bytes`;
}
