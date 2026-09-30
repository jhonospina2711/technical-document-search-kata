import { FileStore } from '../../documents/application/ports';
import { Document, DocumentFormat, DocumentStatus } from '../../documents/domain/document';
import { ContentExtractionError, UnsupportedFormatError } from './errors';
import { ContentExtractor, DocumentProcessingRepository } from './ports';
import { ProcessDocument } from './process-document.use-case';

const pending: Document = {
  id: 'doc-1',
  title: 't',
  author: 'a',
  category: 'c',
  tags: [],
  version: '1',
  fileName: 'a.txt',
  fileFormat: DocumentFormat.TXT,
  ownerId: 'u',
  status: DocumentStatus.PROCESANDO,
  content: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProcessDocument', () => {
  let documents: jest.Mocked<DocumentProcessingRepository>;
  let files: jest.Mocked<FileStore>;
  let extractor: jest.Mocked<ContentExtractor>;
  let useCase: ProcessDocument;

  beforeEach(() => {
    documents = { findById: jest.fn().mockResolvedValue(pending), saveOutcome: jest.fn().mockResolvedValue(true) };
    files = {
      save: jest.fn(),
      read: jest.fn().mockResolvedValue(Buffer.from('hola')),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    extractor = { extract: jest.fn().mockResolvedValue('hola') };
    useCase = new ProcessDocument(documents, files, extractor);
  });

  it('procesa: guarda PROCESADO con el contenido y elimina el archivo (AC-01)', async () => {
    await useCase.execute('doc-1');

    expect(extractor.extract).toHaveBeenCalledWith(DocumentFormat.TXT, Buffer.from('hola'));
    expect(documents.saveOutcome).toHaveBeenCalledWith({ ...pending, status: DocumentStatus.PROCESADO, content: 'hola' });
    expect(files.remove).toHaveBeenCalledWith('doc-1');
  });

  it('un formato sin extractor deja el documento en ERROR y elimina el archivo (AC-03)', async () => {
    extractor.extract.mockRejectedValue(new UnsupportedFormatError('DOCX'));

    await expect(useCase.execute('doc-1')).resolves.toBeUndefined();

    expect(documents.saveOutcome).toHaveBeenCalledWith({ ...pending, status: DocumentStatus.ERROR });
    expect(files.remove).toHaveBeenCalledWith('doc-1');
  });

  it.each([
    ['archivo ausente', () => files.read.mockResolvedValue(null)],
    ['contenido no extraíble', () => extractor.extract.mockRejectedValue(new ContentExtractionError('vacío'))],
  ])('%s deja el documento en ERROR sin propagar (AC-04)', async (_name, arrange) => {
    arrange();

    await expect(useCase.execute('doc-1')).resolves.toBeUndefined();

    expect(documents.saveOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: DocumentStatus.ERROR, content: null }),
    );
  });

  it('un documento inexistente se descarta sin escribir ni borrar nada (AC-05)', async () => {
    documents.findById.mockResolvedValue(null);

    await expect(useCase.execute('doc-1')).resolves.toBeUndefined();

    expect(files.read).not.toHaveBeenCalled();
    expect(documents.saveOutcome).not.toHaveBeenCalled();
    expect(files.remove).not.toHaveBeenCalled();
  });

  it.each([DocumentStatus.PROCESADO, DocumentStatus.ERROR])(
    'un documento ya %s no se reprocesa y se limpia el archivo residual (AC-06)',
    async (status) => {
      documents.findById.mockResolvedValue({ ...pending, status });

      await useCase.execute('doc-1');

      expect(files.read).not.toHaveBeenCalled();
      expect(documents.saveOutcome).not.toHaveBeenCalled();
      expect(files.remove).toHaveBeenCalledWith('doc-1');
    },
  );

  it('si el documento ya no estaba en PROCESANDO al guardar, no falla (AC-07)', async () => {
    documents.saveOutcome.mockResolvedValue(false);

    await expect(useCase.execute('doc-1')).resolves.toBeUndefined();
  });

  it('un error transitorio al guardar se propaga sin borrar el archivo', async () => {
    documents.saveOutcome.mockRejectedValue(new Error('conexión perdida'));

    await expect(useCase.execute('doc-1')).rejects.toThrow('conexión perdida');
    expect(files.remove).not.toHaveBeenCalled();
  });

  it.each([
    ['lectura', () => files.read.mockRejectedValue(new Error('EIO'))],
    ['búsqueda', () => documents.findById.mockRejectedValue(new Error('db caída'))],
  ])('un fallo de %s es transitorio y no marca ERROR', async (_name, arrange) => {
    arrange();

    await expect(useCase.execute('doc-1')).rejects.toThrow();
    expect(documents.saveOutcome).not.toHaveBeenCalled();
  });

  it('si el borrado del archivo falla, el documento queda resuelto y no falla (AC-11)', async () => {
    files.remove.mockRejectedValue(new Error('EPERM'));

    await expect(useCase.execute('doc-1')).resolves.toBeUndefined();

    expect(documents.saveOutcome).toHaveBeenCalledTimes(1);
  });
});
