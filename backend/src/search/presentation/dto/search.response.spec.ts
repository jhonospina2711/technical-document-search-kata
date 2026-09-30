import { DocumentFormat } from '../../../documents/domain/document';
import { SearchOutcome } from '../../application/search-documents.use-case';
import { toSearchResponse } from './search.response';

const snippet = { segments: [{ text: 'redis', highlight: true }], truncatedStart: false, truncatedEnd: true };

describe('toSearchResponse', () => {
  const outcome: SearchOutcome = {
    hits: [
      {
        id: 'doc-1',
        title: 'Guía',
        author: 'Ana',
        format: DocumentFormat.PDF,
        version: '1.0.0',
        tags: ['cache'],
        createdAt: new Date('2026-09-30T10:00:00.000Z'),
        score: 0.4217,
        snippet,
        // Campos internos que no deben salir aunque el objeto los trajera.
        ...({ ownerId: 'u-1', content: 'secreto', status: 'PROCESADO' } as object),
      },
    ],
    total: 24,
    pendingCount: 2,
    tookMs: 38,
  };

  it('arma el contrato de SPEC-10 con fechas ISO (FR-06)', () => {
    expect(toSearchResponse(outcome, { page: 2, pageSize: 10 })).toEqual({
      items: [
        {
          id: 'doc-1',
          title: 'Guía',
          author: 'Ana',
          format: 'PDF',
          version: '1.0.0',
          tags: ['cache'],
          createdAt: '2026-09-30T10:00:00.000Z',
          score: 0.4217,
          snippet,
        },
      ],
      total: 24,
      page: 2,
      pageSize: 10,
      tookMs: 38,
      pendingCount: 2,
    });
  });

  it('no expone ownerId, content ni status', () => {
    const [item] = toSearchResponse(outcome, { page: 1, pageSize: 10 }).items;

    expect(Object.keys(item)).not.toEqual(expect.arrayContaining(['ownerId']));
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('status');
  });

  it('devuelve items vacío con el total real en una página fuera de rango', () => {
    const response = toSearchResponse({ ...outcome, hits: [] }, { page: 4, pageSize: 10 });

    expect(response).toMatchObject({ items: [], total: 24, page: 4, pageSize: 10 });
  });

  it('tags siempre es una lista', () => {
    const hit = { ...outcome.hits[0], tags: null as unknown as string[] };

    expect(toSearchResponse({ ...outcome, hits: [hit] }, { page: 1, pageSize: 10 }).items[0].tags).toEqual([]);
  });
});
