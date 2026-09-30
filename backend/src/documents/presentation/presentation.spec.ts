import { ArgumentsHost, BadRequestException, PayloadTooLargeException, ParseUUIDPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetDocument } from '../application/get-document.use-case';
import { UploadDocument } from '../application/upload-document.use-case';
import { Document, DocumentFormat, DocumentStatus } from '../domain/document';
import {
  DocumentNotFoundError,
  EmptyFileError,
  EventPublishError,
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
  const getExecute = jest.fn();
  const controller = new DocumentsController(
    { execute } as unknown as UploadDocument,
    { execute: getExecute } as unknown as GetDocument,
  );
  const req = { user: { id: 'user-1' }, headers: {} } as never;
  const dto = { ...valid, tags: ['a'] } as UploadDocumentDto;

  beforeEach(() => {
    execute.mockReset();
    getExecute.mockReset();
  });

  const stored: Document = {
    id: 'doc-1', title: 't', author: 'a', category: 'c', tags: ['x'], version: '1.0.0', fileName: 'f.md',
    fileFormat: DocumentFormat.MD, ownerId: 'user-9', status: DocumentStatus.PROCESADO, content: '# hola',
    createdAt: new Date('2026-05-14T09:30:00Z'), updatedAt: new Date('2026-05-18T14:15:00Z'),
  };

  it('devuelve el detalle sin ownerId y con fechas ISO (AC-01)', async () => {
    getExecute.mockResolvedValue(stored);

    const detail = await controller.get('doc-1', req);

    expect(getExecute).toHaveBeenCalledWith('doc-1');
    expect(detail).toEqual({
      id: 'doc-1', title: 't', author: 'a', category: 'c', tags: ['x'], version: '1.0.0', fileName: 'f.md',
      fileFormat: 'MD', status: 'PROCESADO', content: '# hola',
      createdAt: '2026-05-14T09:30:00.000Z', updatedAt: '2026-05-18T14:15:00.000Z',
    });
    expect(detail).not.toHaveProperty('ownerId');
  });

  it('conserva content null en PROCESANDO y tags vacío como lista (AC-02, AC-07)', async () => {
    getExecute.mockResolvedValue({ ...stored, status: DocumentStatus.PROCESANDO, content: null, tags: [] });

    await expect(controller.get('doc-1', req)).resolves.toMatchObject({ status: 'PROCESANDO', content: null, tags: [] });
  });

  it('propaga DocumentNotFoundError del caso de uso (AC-03)', async () => {
    getExecute.mockRejectedValue(new DocumentNotFoundError());

    await expect(controller.get('nope', req)).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

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

describe('validación del :id de GET /documents/:id', () => {
  // El pipe se declara en el parámetro `id` del método `get`; se lee de los metadatos de Nest.
  const routeArguments = Reflect.getMetadata('__routeArguments__', DocumentsController, 'get') as Record<
    string,
    { data?: string; pipes: ParseUUIDPipe[] }
  >;
  const pipe = Object.values(routeArguments).find((argument) => argument.data === 'id')!.pipes[0];
  const meta = { type: 'param', data: 'id' } as never;

  it.each(['abc', '123', ''])('rechaza "%s" con 400 y mensaje en español (AC-04)', async (id) => {
    await expect(pipe.transform(id, meta)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ message: 'Identificador de documento inválido' }),
    });
  });

  it('acepta un UUID', async () => {
    const id = '3f2b8c1e-7a4d-4e6b-9c1f-2d5a8b7c6e10';

    await expect(pipe.transform(id, meta)).resolves.toBe(id);
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

  it('traduce DocumentNotFoundError a 404 sin incluir el id (AC-03)', () => {
    expect(respond(new DocumentNotFoundError())).toEqual({
      status: 404,
      body: { statusCode: 404, message: 'Documento no encontrado', error: 'Not Found' },
    });
  });

  it('responde 503 sin detalles internos si el broker no confirmó el evento (AC-03)', () => {
    const { status, body } = respond(new EventPublishError({ cause: new Error('connect ECONNREFUSED amqp://u:secreta@rabbit') }));

    expect(status).toBe(503);
    expect(body).toEqual({
      statusCode: 503,
      message: 'Servicio no disponible, intenta de nuevo',
      error: 'Service Unavailable',
    });
    expect(JSON.stringify(body)).not.toMatch(/secreta|rabbit|ECONNREFUSED/);
  });

  it('deja pasar sin cambios otras respuestas 400 (validación del DTO, archivo ausente)', () => {
    expect(respond(new BadRequestException('Falta el archivo en el campo "file"'))).toEqual({
      status: 400,
      body: expect.objectContaining({ message: 'Falta el archivo en el campo "file"' }),
    });
  });
});
