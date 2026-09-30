import { Document, DocumentFormat, DocumentStatus } from '../domain/document';
import { DocumentRepository } from '../domain/document.repository';
import { DocumentNotFoundError } from '../domain/errors';
import { GetDocument } from './get-document.use-case';

const document: Document = {
  id: 'doc-1', title: 't', author: 'a', category: 'c', tags: [], version: '1.0.0', fileName: 'f.md',
  fileFormat: DocumentFormat.MD, ownerId: 'u', status: DocumentStatus.PROCESADO, content: 'texto',
  createdAt: new Date(), updatedAt: new Date(),
};

describe('GetDocument', () => {
  const findById = jest.fn();
  const useCase = new GetDocument({ findById } as unknown as DocumentRepository);

  beforeEach(() => findById.mockReset());

  it('devuelve el documento existente (AC-01)', async () => {
    findById.mockResolvedValue(document);

    await expect(useCase.execute('doc-1')).resolves.toBe(document);
    expect(findById).toHaveBeenCalledWith('doc-1');
  });

  it('lanza DocumentNotFoundError si no existe (AC-03)', async () => {
    findById.mockResolvedValue(null);

    await expect(useCase.execute('nope')).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});
