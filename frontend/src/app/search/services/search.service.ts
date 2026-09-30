import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SEARCH_PAGE_SIZE, SearchParams, SearchResponse } from '../interfaces/search.interfaces';
import { MOCK_LATENCY_MS, searchMock } from './search.mock';

/** `unauthorized`: 401 (ya lo gestiona `authInterceptor`, la página no muestra nada); `generic`: cualquier otro fallo. */
export type SearchFailureKind = 'unauthorized' | 'generic';

export interface SearchFailure {
  kind: SearchFailureKind;
  message: string;
  retryable: boolean;
}

const GENERIC_FAILURE: SearchFailure = {
  kind: 'generic',
  // La página ya titula el aviso «No se pudo completar la búsqueda»; aquí solo va el detalle.
  message: 'Inténtalo de nuevo en unos segundos.',
  retryable: true,
};

/** Traduce cualquier fallo a un mensaje genérico en español, sin códigos ni detalles internos. */
export function mapSearchError(error: unknown): SearchFailure {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return { kind: 'unauthorized', message: 'Tu sesión expiró. Inicia sesión de nuevo', retryable: false };
  }
  return GENERIC_FAILURE;
}

function assertSearchResponse(body: SearchResponse | null): SearchResponse {
  if (!body || !Array.isArray(body.items) || typeof body.total !== 'number') {
    throw new Error('Respuesta de búsqueda inesperada');
  }
  return body;
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/search`;

  /** Busca documentos; los fallos llegan como `SearchFailure`. */
  search(params: SearchParams): Observable<SearchResponse> {
    const response$ = environment.useMockSearch ? this.searchInMock(params) : this.searchInApi(params);
    return response$.pipe(catchError((error: unknown) => throwError(() => mapSearchError(error))));
  }

  private searchInApi(params: SearchParams): Observable<SearchResponse> {
    const query = new HttpParams()
      .set('q', params.q)
      .set('sort', params.sort)
      .set('page', params.page)
      .set('pageSize', SEARCH_PAGE_SIZE);
    return this.http.get<SearchResponse>(this.baseUrl, { params: query }).pipe(map(assertSearchResponse));
  }

  private searchInMock(params: SearchParams): Observable<SearchResponse> {
    // Con `timer` también el fallo simulado llega tras la latencia, como uno real.
    return timer(MOCK_LATENCY_MS).pipe(map(() => searchMock(params)));
  }
}
