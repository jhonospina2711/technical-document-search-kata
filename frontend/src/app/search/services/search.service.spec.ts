import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { SearchParams, SearchResponse } from '../interfaces/search.interfaces';
import { MOCK_LATENCY_MS } from './search.mock';
import { SearchFailure, SearchService, mapSearchError } from './search.service';

const PARAMS: SearchParams = { q: 'configuración de kubernetes', sort: 'relevance', page: 1 };

const RESPONSE: SearchResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  tookMs: 12,
  pendingCount: 0,
};

describe('SearchService', () => {
  let service: SearchService;
  let http: HttpTestingController;
  const originalFlag = environment.useMockSearch;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useMockSearch = originalFlag;
    http.verify();
  });

  describe('con la API real (useMockSearch = false)', () => {
    beforeEach(() => {
      environment.useMockSearch = false;
    });

    it('llama a GET /search con q, sort, page y pageSize codificados', () => {
      let result: SearchResponse | undefined;
      service.search({ q: 'a&b=c #1', sort: 'date-desc', page: 3 }).subscribe((value) => (result = value));

      const req = http.expectOne((request) => request.url === `${environment.apiUrl}/search`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('a&b=c #1');
      expect(req.request.params.get('sort')).toBe('date-desc');
      expect(req.request.params.get('page')).toBe('3');
      expect(req.request.params.get('pageSize')).toBe('10');
      expect(req.request.urlWithParams).not.toContain('a&b=c #1');
      req.flush(RESPONSE);

      expect(result).toEqual(RESPONSE);
    });

    it('trata una respuesta con forma inesperada como error genérico', () => {
      let failure: SearchFailure | undefined;
      service.search(PARAMS).subscribe({ error: (error: SearchFailure) => (failure = error) });

      http.expectOne((request) => request.url.endsWith('/search')).flush({ resultados: [] });

      expect(failure?.kind).toBe('generic');
      expect(failure?.retryable).toBeTrue();
    });

    it('mapea fallos HTTP a un error sin detalles internos', () => {
      for (const status of [400, 500, 503, 504]) {
        let failure: SearchFailure | undefined;
        service.search(PARAMS).subscribe({ error: (error: SearchFailure) => (failure = error) });

        http
          .expectOne((request) => request.url.endsWith('/search'))
          .flush({ message: 'timeout en el motor FTS' }, { status, statusText: 'x' });

        expect(failure?.kind).withContext(`${status}`).toBe('generic');
        expect(failure?.retryable).toBeTrue();
        expect(failure?.message).not.toMatch(/FTS|timeout|\d{3}/);
      }
    });

    it('mapea un error de red', () => {
      let failure: SearchFailure | undefined;
      service.search(PARAMS).subscribe({ error: (error: SearchFailure) => (failure = error) });

      http.expectOne((request) => request.url.endsWith('/search')).error(new ProgressEvent('error'));

      expect(failure?.kind).toBe('generic');
    });

    it('mapea el 401 como no autorizado y no reintentable', () => {
      let failure: SearchFailure | undefined;
      service.search(PARAMS).subscribe({ error: (error: SearchFailure) => (failure = error) });

      http.expectOne((request) => request.url.endsWith('/search')).flush(null, { status: 401, statusText: 'x' });

      expect(failure?.kind).toBe('unauthorized');
      expect(failure?.retryable).toBeFalse();
    });
  });

  describe('con el mock (useMockSearch = true)', () => {
    beforeEach(() => {
      environment.useMockSearch = true;
    });

    it('responde desde el mock tras la latencia y sin ninguna petición HTTP', fakeAsync(() => {
      let result: SearchResponse | undefined;
      service.search(PARAMS).subscribe((value) => (result = value));

      tick(MOCK_LATENCY_MS - 1);
      expect(result).toBeUndefined();
      tick(1);

      expect(result?.total).toBeGreaterThan(0);
      expect(result?.items.length).toBeLessThanOrEqual(10);
      http.expectNone(() => true);
    }));

    it('devuelve vacío para un término sin coincidencias', fakeAsync(() => {
      let result: SearchResponse | undefined;
      service.search({ ...PARAMS, q: 'zzzzzz' }).subscribe((value) => (result = value));
      tick(MOCK_LATENCY_MS);

      expect(result?.total).toBe(0);
      expect(result?.items).toEqual([]);
    }));

    it('falla con el término reservado, tras la latencia, como error genérico', fakeAsync(() => {
      let failure: SearchFailure | undefined;
      service.search({ ...PARAMS, q: 'error' }).subscribe({ error: (error: SearchFailure) => (failure = error) });

      tick(MOCK_LATENCY_MS - 1);
      expect(failure).toBeUndefined();
      tick(1);

      expect(failure?.kind).toBe('generic');
      expect(failure?.retryable).toBeTrue();
    }));
  });
});

describe('mapSearchError', () => {
  it('devuelve el error genérico para cualquier valor que no sea 401', () => {
    expect(mapSearchError(new Error('boom')).kind).toBe('generic');
    expect(mapSearchError(new HttpErrorResponse({ status: 0 })).kind).toBe('generic');
    expect(mapSearchError(undefined).retryable).toBeTrue();
  });
});
