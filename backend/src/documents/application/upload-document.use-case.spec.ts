import { Document, DocumentFormat, DocumentStatus, NewDocument } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import {
  EmptyFileError,
  InvalidFileContentError,
  InvalidFileNameError,
  UnsupportedFileFormatError,
} from '../domain/errors';
import { FileStore } from './ports';
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

  async save(documentId: string, content: Buffer): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.saved.set(documentId, content);
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
  let useCase: UploadDocument;

  beforeEach(() => {
    documents = new InMemoryDocuments();
    files = new InMemoryFiles();
    useCase = new UploadDocument(documents, files);
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

  it('elimina el registro si no puede guardar el archivo', async () => {
    files.failWith = new Error('disco lleno');

    await expect(useCase.execute(command('a.pdf', Buffer.from('%PDF-1.7')))).rejects.toThrow('disco lleno');
    expect(documents.rows.size).toBe(0);
  });
});
