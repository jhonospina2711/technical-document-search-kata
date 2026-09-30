import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { createDocument, DocumentFormat } from '../domain/document';
import { DocumentOrmEntity } from './document.orm-entity';
import { FilesystemFileStore } from './filesystem-file-store';
import { TypeOrmDocumentRepository } from './typeorm-document.repository';

describe('TypeOrmDocumentRepository', () => {
  const orm = {
    create: jest.fn((value: object) => ({ ...value })),
    save: jest.fn(async (value: object) => ({ ...value, id: 'doc-1', createdAt: new Date(), updatedAt: new Date() })),
    delete: jest.fn(),
  };
  const repository = new TypeOrmDocumentRepository(orm as unknown as Repository<DocumentOrmEntity>);

  it('persiste el documento nuevo y devuelve el id asignado', async () => {
    const document = createDocument({
      title: 't', author: 'a', category: 'c', tags: [], version: '1', fileName: 'f.md',
      fileFormat: DocumentFormat.MD, ownerId: 'u',
    });

    const saved = await repository.add(document);

    expect(orm.create).toHaveBeenCalledWith(document);
    expect(saved).toMatchObject({ id: 'doc-1', status: 'PROCESANDO', content: null });
  });

  it('elimina por id', async () => {
    await repository.remove('doc-1');
    expect(orm.delete).toHaveBeenCalledWith({ id: 'doc-1' });
  });
});

describe('FilesystemFileStore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = join(await mkdtemp(join(tmpdir(), 'docsearch-')), 'nested');
  });

  afterEach(() => rm(join(directory, '..'), { recursive: true, force: true }));

  it('guarda el archivo como <UPLOAD_DIR>/<id>, creando el directorio si no existe', async () => {
    const store = new FilesystemFileStore({ getOrThrow: () => directory } as unknown as ConfigService);

    await store.save('doc-1', Buffer.from('contenido'));

    expect((await readFile(join(directory, 'doc-1'))).toString()).toBe('contenido');
  });

  it('lee el archivo guardado y devuelve null si no existe', async () => {
    const store = new FilesystemFileStore({ getOrThrow: () => directory } as unknown as ConfigService);
    await store.save('doc-1', Buffer.from('contenido'));

    expect((await store.read('doc-1'))?.toString()).toBe('contenido');
    expect(await store.read('otro')).toBeNull();
  });

  it('propaga los errores de lectura distintos de ENOENT', async () => {
    const store = new FilesystemFileStore({ getOrThrow: () => directory } as unknown as ConfigService);
    await store.save('doc-1', Buffer.from('x'));
    await mkdir(join(directory, 'carpeta'));

    await expect(store.read('carpeta')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('elimina el archivo y no falla si ya no existe', async () => {
    const store = new FilesystemFileStore({ getOrThrow: () => directory } as unknown as ConfigService);
    await store.save('doc-1', Buffer.from('contenido'));

    await store.remove('doc-1');
    await expect(readFile(join(directory, 'doc-1'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.remove('doc-1')).resolves.toBeUndefined();
  });
});
