import { HttpErrorResponse } from '@angular/common/http';
import { SEARCH_PAGE_SIZE, SearchParams } from '../interfaces/search.interfaces';
import { MOCK_DOCUMENTS, MOCK_ERROR_TERM, searchMock } from './search.mock';

const params = (overrides: Partial<SearchParams> = {}): SearchParams => ({
  q: 'kubernetes',
  sort: 'relevance',
  page: 1,
  ...overrides,
});

describe('searchMock', () => {
  it('encuentra documentos que contienen todos los términos, ignorando acentos y mayúsculas', () => {
    const accented = searchMock(params({ q: 'CONFIGURACION kubernetes' }));
    const plain = searchMock(params({ q: 'configuración de kubernetes' }));
    expect(accented.total).toBeGreaterThan(0);
    expect(accented.total).toBe(plain.total);
  });

  it('no devuelve documentos que no contienen todos los términos', () => {
    const response = searchMock(params({ q: 'terraform kubernetes' }));
    expect(response.total).toBe(0);
  });

  it('devuelve vacío para términos sin coincidencia o demasiado cortos', () => {
    expect(searchMock(params({ q: 'zzzzzz' })).total).toBe(0);
    expect(searchMock(params({ q: 'de' })).total).toBe(0);
    expect(searchMock(params({ q: '' })).items).toEqual([]);
  });

  it('lanza un 500 simulado con el término reservado', () => {
    for (const q of [MOCK_ERROR_TERM, '  ERROR ']) {
      let failure: unknown;
      try {
        searchMock(params({ q }));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(HttpErrorResponse);
      expect((failure as HttpErrorResponse).status).toBe(500);
    }
  });

  it('pagina en bloques de 10 y conserva el total', () => {
    const first = searchMock(params({ page: 1 }));
    const second = searchMock(params({ page: 2 }));
    expect(first.total).toBeGreaterThan(SEARCH_PAGE_SIZE);
    expect(first.items.length).toBe(SEARCH_PAGE_SIZE);
    expect(second.items.length).toBe(first.total - SEARCH_PAGE_SIZE);
    expect(second.total).toBe(first.total);
    expect(first.pageSize).toBe(SEARCH_PAGE_SIZE);
    expect(second.page).toBe(2);
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('devuelve items vacío pero total conservado en una página fuera de rango', () => {
    const response = searchMock(params({ page: 99 }));
    expect(response.items).toEqual([]);
    expect(response.total).toBeGreaterThan(0);
  });

  it('ordena por relevancia descendente y calcula puntuaciones entre 0 y 1', () => {
    const { items } = searchMock(params());
    const scores = items.map((item) => item.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((score) => score > 0 && score <= 1)).toBeTrue();
  });

  it('ordena por fecha y por título', () => {
    const desc = searchMock(params({ sort: 'date-desc' })).items.map((item) => item.createdAt);
    const asc = searchMock(params({ sort: 'date-asc' })).items.map((item) => item.createdAt);
    expect(desc).toEqual([...desc].sort().reverse());
    expect(asc).toEqual([...asc].sort());
    const titles = searchMock(params({ sort: 'title' })).items.map((item) => item.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'es')));
  });

  it('marca como resaltados los términos buscados en el fragmento', () => {
    const { items } = searchMock(params({ q: 'kubernetes' }));
    for (const item of items) {
      const highlighted = item.snippet.segments.filter((segment) => segment.highlight);
      expect(highlighted.length).withContext(item.title).toBeGreaterThan(0);
      expect(highlighted.every((segment) => segment.text.toLowerCase() === 'kubernetes')).toBeTrue();
    }
  });

  it('recorta el fragmento e indica el truncado por cada extremo', () => {
    const long = MOCK_DOCUMENTS[0];
    const snippetFor = (q: string) =>
      searchMock(params({ q })).items.find((candidate) => candidate.id === long.id)!.snippet;

    const atStart = snippetFor('introduccion');
    expect(atStart.truncatedStart).toBeFalse();
    expect(atStart.truncatedEnd).toBeTrue();

    const atEnd = snippetFor('etcd');
    expect(atEnd.truncatedStart).toBeTrue();
    expect(atEnd.truncatedEnd).toBeFalse();
    const text = atEnd.segments.map((segment) => segment.text).join('');
    expect(text.length).toBeLessThan(long.content.length);
    expect(long.content).toContain(text);
  });

  it('no trunca un fragmento corto', () => {
    const { items } = searchMock(params({ q: 'terraform' }));
    expect(items[0].snippet.truncatedStart).toBeFalse();
    expect(items[0].snippet.truncatedEnd).toBeFalse();
  });

  it('no expone el contenido completo en los resultados', () => {
    const { items } = searchMock(params());
    expect(items.every((item) => !('content' in item))).toBeTrue();
  });

  it('informa tiempo simulado y documentos pendientes', () => {
    const response = searchMock(params());
    expect(response.tookMs).toBe(420);
    expect(response.pendingCount).toBeGreaterThan(0);
  });
});
