import { DataSource } from 'typeorm';
import { DocumentFormat } from '../../documents/domain/document';
import { SEARCH_SORTS, SearchSort } from '../domain/document-search.repository';
import { HIGHLIGHT_START, HIGHLIGHT_STOP } from './headline-segments';
import { TypeOrmDocumentSearchRepository } from './typeorm-document-search.repository';

const row = {
  id: 'doc-1',
  title: 'Guía de Redis',
  author: 'Ana',
  file_format: DocumentFormat.MD,
  version: '1.0.0',
  tags: null,
  created_at: new Date('2026-09-30T10:00:00.000Z'),
  score: 0.421749,
  headline: `uso de ${HIGHLIGHT_START}redis${HIGHLIGHT_STOP} en producción`,
  truncated_start: true,
  truncated_end: false,
};

describe('TypeOrmDocumentSearchRepository', () => {
  const query = jest.fn();
  const repository = new TypeOrmDocumentSearchRepository({ query } as unknown as DataSource);

  beforeEach(() => {
    query.mockReset();
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('pending_count') ? [{ total: 24, pending_count: 2 }] : [row]),
    );
  });

  const pageCall = () => query.mock.calls.find(([sql]: [string]) => !sql.includes('pending_count')) as [string, unknown[]];
  const countsCall = () => query.mock.calls.find(([sql]: [string]) => sql.includes('pending_count')) as [string, unknown[]];

  it('mapea filas a resultados con score redondeado, segmentos y tags vacías (AC-01, AC-06)', async () => {
    const page = await repository.search({ query: 'redis', sort: 'relevance', page: 1, pageSize: 10 });

    expect(page.total).toBe(24);
    expect(page.pendingCount).toBe(2);
    expect(page.hits).toEqual([
      {
        id: 'doc-1',
        title: 'Guía de Redis',
        author: 'Ana',
        format: DocumentFormat.MD,
        version: '1.0.0',
        tags: [],
        createdAt: row.created_at,
        score: 0.4217,
        snippet: {
          segments: [
            { text: 'uso de ', highlight: false },
            { text: 'redis', highlight: true },
            { text: ' en producción', highlight: false },
          ],
          truncatedStart: true,
          truncatedEnd: false,
        },
      },
    ]);
  });

  it('envía el término, límite, desplazamiento y opciones como parámetros, no en el SQL (AC-08, AC-15)', async () => {
    const term = `'; DROP TABLE documents;--`;

    await repository.search({ query: term, sort: 'relevance', page: 3, pageSize: 10 });

    const [sql, params] = pageCall();
    expect(params.slice(0, 3)).toEqual([term, 10, 20]);
    expect(params[3]).toContain('MaxFragments=1');
    expect(sql).not.toContain(term);
    expect(countsCall()[1]).toEqual([term]);
  });

  it.each<[SearchSort, RegExp]>([
    ['relevance', /ORDER BY score DESC, created_at DESC, id ASC\s+LIMIT/],
    ['date-desc', /ORDER BY created_at DESC, id ASC\s+LIMIT/],
    ['date-asc', /ORDER BY created_at ASC, id ASC\s+LIMIT/],
    ['title', /ORDER BY title ASC, id ASC\s+LIMIT/],
  ])('ordena por %s con desempate por id (AC-09)', async (sort, expected) => {
    await repository.search({ query: 'x', sort, page: 1, pageSize: 10 });

    expect(pageCall()[0]).toMatch(expected);
  });

  it('reaplica el orden tras unir con documents, con columnas calificadas', async () => {
    await repository.search({ query: 'x', sort: 'relevance', page: 1, pageSize: 10 });

    expect(pageCall()[0]).toMatch(/ORDER BY p\.score DESC, p\.created_at DESC, p\.id ASC\s*$/);
  });

  it('busca solo con @@ sobre documentos PROCESADO y nunca con LIKE (AC-15)', async () => {
    for (const sort of SEARCH_SORTS) {
      await repository.search({ query: 'x', sort, page: 1, pageSize: 10 });
    }

    for (const [sql] of query.mock.calls as [string][]) {
      expect(sql).not.toMatch(/\b(i?like)\b/i);
      expect(sql).toContain("websearch_to_tsquery('documents_es', $1)");
      expect(sql).toContain("status = 'PROCESADO'");
    }
    expect(pageCall()[0]).toContain('search_vector @@ q.tsq');
  });

  it('calcula el cuerpo y ts_headline una sola vez por fila: los LATERAL no se aplanan', async () => {
    await repository.search({ query: 'x', sort: 'relevance', page: 1, pageSize: 10 });

    const [sql] = pageCall();
    expect(sql).toContain('AS body OFFSET 0) b');
    expect(sql).toContain('AS headline OFFSET 0) h');
  });

  it('devuelve una página vacía con el total real cuando la página está fuera de rango (AC-08)', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('pending_count') ? [{ total: 24, pending_count: 0 }] : []),
    );

    await expect(repository.search({ query: 'x', sort: 'relevance', page: 4, pageSize: 10 })).resolves.toEqual({
      hits: [],
      total: 24,
      pendingCount: 0,
    });
  });

  it('trata un fragmento nulo (sin contenido) como snippet vacío', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('pending_count')
          ? [{ total: 1, pending_count: 0 }]
          : [{ ...row, headline: null, truncated_start: null, truncated_end: null }],
      ),
    );

    const { hits } = await repository.search({ query: 'x', sort: 'relevance', page: 1, pageSize: 10 });

    expect(hits[0].snippet).toEqual({ segments: [], truncatedStart: false, truncatedEnd: false });
  });

  it('propaga el error de la base de datos', async () => {
    query.mockRejectedValue(new Error('db'));

    await expect(repository.search({ query: 'x', sort: 'relevance', page: 1, pageSize: 10 })).rejects.toThrow('db');
  });
});
