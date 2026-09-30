import { ParamMap } from '@angular/router';
import { SearchParams, SearchSort } from '../interfaces/search.interfaces';

export const SEARCH_QUERY_MAX_LENGTH = 200;

export const SEARCH_SORTS: readonly { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'date-desc', label: 'Fecha: más reciente' },
  { value: 'date-asc', label: 'Fecha: más antigua' },
  { value: 'title', label: 'Título (A-Z)' },
];

const DEFAULT_SORT: SearchSort = 'relevance';

function isSearchSort(value: string | null): value is SearchSort {
  return SEARCH_SORTS.some((sort) => sort.value === value);
}

/** Normaliza los query params: `q` recortado y acotado, `sort` y `page` inválidos vuelven a su valor por defecto. */
export function parseSearchParams(params: ParamMap): SearchParams {
  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  const rawSort = params.get('sort');
  const sort = isSearchSort(rawSort) ? rawSort : DEFAULT_SORT;
  const rawPage = params.get('page');
  const page = rawPage !== null && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  return { q, sort, page };
}
