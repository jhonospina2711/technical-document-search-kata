import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UploadDocument } from '../application/upload-document.use-case';
import { DocumentStatus } from '../domain/document';
import { EmptyFileError, UnsupportedFileFormatError } from '../domain/errors';
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
  it.each([new UnsupportedFileFormatError('x.exe'), new EmptyFileError()])(
    'traduce %p a 400 con su mensaje',
    (error) => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const host = {
        switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({ status }) }),
      } as unknown as ArgumentsHost;

      new DocumentsExceptionFilter().catch(error, host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: error.message }));
    },
  );
});
