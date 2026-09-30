import { convertToParamMap } from '@angular/router';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_SORTS, parseSearchParams } from './search-params';

const parse = (params: Record<string, string>) => parseSearchParams(convertToParamMap(params));

describe('parseSearchParams', () => {
  it('usa los valores por defecto sin parámetros', () => {
    expect(parse({})).toEqual({ q: '', sort: 'relevance', page: 1 });
  });

  it('lee q, sort y page válidos', () => {
    expect(parse({ q: 'kubernetes', sort: 'date-desc', page: '3' })).toEqual({
      q: 'kubernetes',
      sort: 'date-desc',
      page: 3,
    });
  });

  it('acepta los cuatro criterios de orden', () => {
    for (const { value } of SEARCH_SORTS) {
      expect(parse({ sort: value }).sort).toBe(value);
    }
  });

  it('recorta q y trata solo espacios como vacío', () => {
    expect(parse({ q: '  helm  ' }).q).toBe('helm');
    expect(parse({ q: '   ' }).q).toBe('');
  });

  it('acota q a la longitud máxima', () => {
    expect(parse({ q: 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 50) }).q.length).toBe(SEARCH_QUERY_MAX_LENGTH);
  });

  it('vuelve a relevance con un sort desconocido', () => {
    expect(parse({ sort: 'xyz' }).sort).toBe('relevance');
  });

  it('vuelve a la página 1 con page inválido', () => {
    for (const page of ['-3', '0', '1.5', 'abc', '', '2e1', ' 2']) {
      expect(parse({ page }).page).withContext(`page="${page}"`).toBe(1);
    }
  });
});
