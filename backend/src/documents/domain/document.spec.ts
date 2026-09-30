import { createDocument, Document, DocumentFormat, DocumentStatus, markFailed, markProcessed } from './document';
import { InvalidDocumentTransitionError } from './errors';

const metadata = {
  title: 'Guía de despliegue',
  author: 'Ada',
  category: 'Operaciones',
  tags: ['docker', 'ci'],
  version: '1.0',
  fileName: 'guia.md',
  fileFormat: DocumentFormat.MD,
  ownerId: 'user-1',
};

function persisted(overrides: Partial<Document> = {}): Document {
  return {
    ...createDocument(metadata),
    id: 'doc-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('createDocument', () => {
  it('nace en PROCESANDO, sin contenido y con los metadatos informados', () => {
    expect(createDocument(metadata)).toEqual({ ...metadata, status: DocumentStatus.PROCESANDO, content: null });
  });

  it('no comparte la lista de etiquetas con la entrada', () => {
    const doc = createDocument(metadata);
    doc.tags.push('extra');
    expect(metadata.tags).toEqual(['docker', 'ci']);
  });
});

describe('transiciones de estado', () => {
  it('PROCESANDO → PROCESADO guarda el contenido', () => {
    const doc = markProcessed(persisted(), 'texto extraído');
    expect(doc.status).toBe(DocumentStatus.PROCESADO);
    expect(doc.content).toBe('texto extraído');
  });

  it('PROCESANDO → ERROR mantiene el contenido nulo', () => {
    const doc = markFailed(persisted());
    expect(doc.status).toBe(DocumentStatus.ERROR);
    expect(doc.content).toBeNull();
  });

  it('no muta el documento original', () => {
    const original = persisted();
    markProcessed(original, 'texto');
    expect(original.status).toBe(DocumentStatus.PROCESANDO);
    expect(original.content).toBeNull();
  });

  it.each([DocumentStatus.PROCESADO, DocumentStatus.ERROR])('rechaza cambiar un documento en %s', (status) => {
    const doc = persisted({ status });
    expect(() => markProcessed(doc, 'x')).toThrow(InvalidDocumentTransitionError);
    expect(() => markFailed(doc)).toThrow(InvalidDocumentTransitionError);
    expect(doc.status).toBe(status);
  });

  it('el error indica el origen y el destino', () => {
    expect(() => markFailed(persisted({ status: DocumentStatus.PROCESADO }))).toThrow(
      'Transición de estado no permitida: PROCESADO → ERROR',
    );
  });
});
