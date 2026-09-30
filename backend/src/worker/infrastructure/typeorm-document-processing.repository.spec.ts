import { Repository } from 'typeorm';
import { Document, DocumentFormat, DocumentStatus } from '../../documents/domain/document';
import { DocumentOrmEntity } from '../../documents/infrastructure/document.orm-entity';
import { TypeOrmDocumentProcessingRepository } from './typeorm-document-processing.repository';

const processed: Document = {
  id: 'doc-1',
  title: 't',
  author: 'a',
  category: 'c',
  tags: [],
  version: '1',
  fileName: 'a.txt',
  fileFormat: DocumentFormat.TXT,
  ownerId: 'u',
  status: DocumentStatus.PROCESADO,
  content: 'hola',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TypeOrmDocumentProcessingRepository', () => {
  const orm = { findOneBy: jest.fn(), update: jest.fn() };
  const repository = new TypeOrmDocumentProcessingRepository(orm as unknown as Repository<DocumentOrmEntity>);

  beforeEach(() => jest.clearAllMocks());

  it('busca el documento por id', async () => {
    orm.findOneBy.mockResolvedValue(processed);

    await expect(repository.findById('doc-1')).resolves.toBe(processed);
    expect(orm.findOneBy).toHaveBeenCalledWith({ id: 'doc-1' });
  });

  it('actualiza estado y contenido solo si sigue en PROCESANDO y devuelve true', async () => {
    orm.update.mockResolvedValue({ affected: 1 });

    await expect(repository.saveOutcome(processed)).resolves.toBe(true);

    expect(orm.update).toHaveBeenCalledWith(
      { id: 'doc-1', status: DocumentStatus.PROCESANDO },
      { status: DocumentStatus.PROCESADO, content: 'hola', updatedAt: expect.any(Function) },
    );
    expect(orm.update.mock.calls[0][1].updatedAt()).toBe('now()');
  });

  it.each([{ affected: 0 }, {}])('devuelve false si no se afectó ninguna fila (%o)', async (result) => {
    orm.update.mockResolvedValue(result);

    await expect(repository.saveOutcome(processed)).resolves.toBe(false);
  });
});
