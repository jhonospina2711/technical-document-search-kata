import { Document, DocumentFormat, DocumentStatus, NewDocument } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import { Logger } from '@nestjs/common';
import {
  EmptyFileError,
  EventPublishError,
  InvalidFileContentError,
  InvalidFileNameError,
  UnsupportedFileFormatError,
} from '../domain/errors';
import { DocumentEventPublisher, FileStore } from './ports';
import { UploadDocument } from './upload-document.use-case';

class InMemoryDocuments extends DocumentRepository {
  readonly rows = new Map<string, Document>();

  async add(document: NewDocument): Promise<Document> {
    const saved: Document = { ...document, id: `id-${this.rows.size + 1}`, createdAt: new Date(), updatedAt: new Date() };
    this.rows.set(saved.id, saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

class InMemoryFiles extends FileStore {
  readonly saved = new Map<string, Buffer>();
  failWith?: Error;
  removeFailWith?: Error;

  async save(documentId: string, content: Buffer): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.saved.set(documentId, content);
  }

  async remove(documentId: string): Promise<void> {
    if (this.removeFailWith) throw this.removeFailWith;
    this.saved.delete(documentId);
  }
}

class RecordingEvents extends DocumentEventPublisher {
  readonly published: string[] = [];
  failWith?: Error;

  async publishUploaded(documentId: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.published.push(documentId);
  }
}

const metadata = { title: 'Guía', author: 'Ada', category: 'Ops', version: '1.0', tags: ['api', 'rest'] };
const command = (originalName: string, content = Buffer.from('hola')) => ({
  metadata,
  file: { originalName, content },
  ownerId: 'user-1',
});

describe('UploadDocument', () => {
  let documents: InMemoryDocuments;
  let files: InMemoryFiles;
  let events: RecordingEvents;
  let useCase: UploadDocument;

  beforeEach(() => {
    documents = new InMemoryDocuments();
    files = new InMemoryFiles();
    events = new RecordingEvents();
    useCase = new UploadDocument(documents, files, events);
  });

  it('registra el documento en PROCESANDO, guarda el archivo y devuelve id y estado (AC-01)', async () => {
    const receipt = await useCase.execute(command('guia.md'));

    expect(receipt).toEqual({ id: 'id-1', status: DocumentStatus.PROCESANDO, fileFormat: DocumentFormat.MD });
    expect(documents.rows.get('id-1')).toMatchObject({
      ...metadata,
      fileName: 'guia.md',
      fileFormat: DocumentFormat.MD,
      status: DocumentStatus.PROCESANDO,
      content: null,
      ownerId: 'user-1',
    });
    expect(files.saved.get('id-1')?.toString()).toBe('hola');
    expect(events.published).toEqual(['id-1']);
  });

  it('guarda solo el nombre base del archivo (AC-09)', async () => {
    await useCase.execute(command('../../etc/x.md'));
    await useCase.execute(command('C:\\tmp\\y.TXT'));

    expect([...documents.rows.values()].map((d) => d.fileName)).toEqual(['x.md', 'y.TXT']);
  });

  it('rechaza extensiones no soportadas sin crear nada (AC-06)', async () => {
    await expect(useCase.execute(command('virus.exe'))).rejects.toThrow(UnsupportedFileFormatError);
    await expect(useCase.execute(command('sin-extension'))).rejects.toThrow(UnsupportedFileFormatError);
    expect(documents.rows.size).toBe(0);
    expect(files.saved.size).toBe(0);
    expect(events.published).toEqual([]);
  });

  it('rechaza archivos vacíos sin crear nada', async () => {
    await expect(useCase.execute(command('a.txt', Buffer.alloc(0)))).rejects.toThrow(EmptyFileError);
    expect(documents.rows.size).toBe(0);
  });

  it('rechaza contenido que no corresponde al formato sin crear nada (AC-06, AC-11)', async () => {
    await expect(useCase.execute(command('a.pdf', Buffer.from('solo texto')))).rejects.toThrow(InvalidFileContentError);
    await expect(useCase.execute(command('a.txt', Buffer.from([0x68, 0x00])))).rejects.toThrow(InvalidFileContentError);
    expect(documents.rows.size).toBe(0);
    expect(files.saved.size).toBe(0);
  });

  it('rechaza nombres inválidos sin crear nada (AC-08, AC-11)', async () => {
    await expect(useCase.execute(command(`${'a'.repeat(256)}.md`))).rejects.toThrow(InvalidFileNameError);
    expect(documents.rows.size).toBe(0);
    expect(files.saved.size).toBe(0);
  });

  it('elimina el registro y no publica si no puede guardar el archivo (AC-07)', async () => {
    files.failWith = new Error('disco lleno');

    await expect(useCase.execute(command('a.pdf', Buffer.from('%PDF-1.7')))).rejects.toThrow('disco lleno');
    expect(documents.rows.size).toBe(0);
    expect(events.published).toEqual([]);
  });

  describe('si falla la publicación del evento', () => {
    let errorLog: jest.SpyInstance;

    beforeEach(() => {
      errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      events.failWith = new EventPublishError();
    });

    afterEach(() => jest.restoreAllMocks());

    it('elimina la fila y el archivo y relanza el error (AC-03)', async () => {
      await expect(useCase.execute(command('guia.md'))).rejects.toThrow(EventPublishError);

      expect(documents.rows.size).toBe(0);
      expect(files.saved.size).toBe(0);
    });

    it('no oculta el error original si la compensación también falla (AC-05)', async () => {
      files.removeFailWith = new Error('permiso denegado');

      await expect(useCase.execute(command('guia.md'))).rejects.toThrow(EventPublishError);

      expect(documents.rows.size).toBe(0); // el otro paso de la compensación se intentó igualmente
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('permiso denegado'));
    });
  });
});
