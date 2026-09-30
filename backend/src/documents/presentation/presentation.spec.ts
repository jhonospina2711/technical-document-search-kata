import { ArgumentsHost, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UploadDocument } from '../application/upload-document.use-case';
import { DocumentStatus } from '../domain/document';
import {
  EmptyFileError,
  InvalidFileContentError,
  InvalidFileNameError,
  UnsupportedFileFormatError,
} from '../domain/errors';
import { DocumentsController } from './documents.controller';
import { DocumentsExceptionFilter } from './documents-exception.filter';
import { UploadDocumentDto } from './dto/upload-document.dto';

const valid = { title: ' Guía ', author: 'Ada', category: 'Ops', version: '1.0' };
const toDto = (plain: object) => plainToInstance(UploadDocumentDto, plain);

describe('UploadDocumentDto', () => {
  it('normaliza tags separados por comas (AC-07)', async () => {
    const dto = toDto({ ...valid, tags: ' api, rest ,,seguridad ' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.title).toBe('Guía');
    expect(dto.tags).toEqual(['api', 'rest', 'seguridad']);
  });

  it('acepta el campo tags repetido y lo omite como lista vacía', async () => {
    expect(toDto({ ...valid, tags: ['a', 'b,c'] }).tags).toEqual(['a', 'b', 'c']);
    expect(toDto(valid).tags).toEqual([]);
  });

  it.each(['title', 'author', 'category', 'version'])('exige %s no vacío (AC-05)', async (field) => {
    expect(await validate(toDto({ ...valid, [field]: undefined }))).not.toHaveLength(0);
    expect(await validate(toDto({ ...valid, [field]: '   ' }))).not.toHaveLength(0);
  });

  it('rechaza tags que no son texto', async () => {
    expect(await validate(toDto({ ...valid, tags: [1, 2] }))).not.toHaveLength(0);
  });
});

describe('DocumentsController', () => {
  const execute = jest.fn();
  const controller = new DocumentsController({ execute } as unknown as UploadDocument);
  const req = { user: { id: 'user-1' }, headers: {} } as never;
  const dto = { ...valid, tags: ['a'] } as UploadDocumentDto;

  beforeEach(() => execute.mockReset());

  it('entrega el archivo al caso de uso con el propietario del token y devuelve id y estado', async () => {
    execute.mockResolvedValue({ id: 'doc-1', status: DocumentStatus.PROCESANDO, fileFormat: 'MD' });
    const file = { originalname: 'a.md', buffer: Buffer.from('x'), size: 1 } as Express.Multer.File;

    await expect(controller.upload(dto, file, req)).resolves.toEqual({ id: 'doc-1', status: 'PROCESANDO' });
    expect(execute).toHaveBeenCalledWith({
      metadata: dto,
      file: { originalName: 'a.md', content: file.buffer },
      ownerId: 'user-1',
    });
  });

  it('responde 400 si falta el archivo (AC-05)', async () => {
    await expect(controller.upload(dto, undefined, req)).rejects.toThrow(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('DocumentsExceptionFilter', () => {
  const respond = (error: Error, maxBytes = 10 * 1024 * 1024) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    const config = { getOrThrow: () => maxBytes } as unknown as ConfigService;

    new DocumentsExceptionFilter(config).catch(error, host);

    return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as { message: string } };
  };

  it.each([
    new UnsupportedFileFormatError('x.exe'),
    new EmptyFileError(),
    new InvalidFileContentError('PDF'),
    new InvalidFileNameError(),
  ])('traduce %p a 400 con su mensaje', (error) => {
    expect(respond(error)).toEqual({
      status: 400,
      body: expect.objectContaining({ message: error.message }),
    });
  });

  it.each([
    [10 * 1024 * 1024, '10 MB'],
    [1536 * 1024, '1.5 MB'],
    [2048, '2 KB'],
    [500, '500 bytes'],
  ])('responde 413 con el límite configurado (%d bytes → %s) (AC-03, AC-05)', (maxBytes, readable) => {
    const { status, body } = respond(new PayloadTooLargeException('File too large'), maxBytes);

    expect(status).toBe(413);
    expect(body.message).toBe(`El archivo supera el tamaño máximo permitido (${readable})`);
  });

  it.each(['Too many files', 'Unexpected field - otro', 'Unexpected file field'])(
    'traduce el error de multer "%s" (AC-09)',
    (message) => {
      expect(respond(new BadRequestException(message))).toEqual({
        status: 400,
        body: expect.objectContaining({ message: 'Solo se admite un archivo en el campo "file"' }),
      });
    },
  );

  it('deja pasar sin cambios otras respuestas 400 (validación del DTO, archivo ausente)', () => {
    expect(respond(new BadRequestException('Falta el archivo en el campo "file"'))).toEqual({
      status: 400,
      body: expect.objectContaining({ message: 'Falta el archivo en el campo "file"' }),
    });
  });
});
