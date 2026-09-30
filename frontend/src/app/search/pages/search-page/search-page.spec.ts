import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject } from 'rxjs';
import { SearchParams, SearchResponse, SearchResultItem } from '../../interfaces/search.interfaces';
import { SearchFailure, SearchService } from '../../services/search.service';
import { SearchPage } from './search-page';

interface Call {
  params: SearchParams;
  subject: Subject<SearchResponse>;
}

/** Sustituye a `SearchService`: cada consulta queda pendiente hasta que el test la resuelva. */
class FakeSearchService {
  readonly calls: Call[] = [];

  search(params: SearchParams): Observable<SearchResponse> {
    const subject = new Subject<SearchResponse>();
    this.calls.push({ params, subject });
    return subject.asObservable();
  }
}

const item = (n: number): SearchResultItem => ({
  id: `id-${n}`,
  title: `Documento ${n}`,
  author: 'Autor',
  format: 'PDF',
  version: '1.0.0',
  tags: ['k8s'],
  createdAt: '2024-10-18T12:00:00.000Z',
  score: 0.9,
  snippet: { segments: [{ text: 'kubernetes', highlight: true }], truncatedStart: false, truncatedEnd: false },
});

const response = (total: number, page = 1, overrides: Partial<SearchResponse> = {}): SearchResponse => ({
  items: Array.from({ length: Math.max(0, Math.min(10, total - (page - 1) * 10)) }, (_, i) => item((page - 1) * 10 + i + 1)),
  total,
  page,
  pageSize: 10,
  tookMs: 420,
  pendingCount: 0,
  ...overrides,
});

const GENERIC: SearchFailure = { kind: 'generic', message: 'No se pudo completar la búsqueda. Inténtalo de nuevo en unos segundos', retryable: true };

describe('SearchPage', () => {
  let fake: FakeSearchService;
  let harness: RouterTestingHarness;
  let router: Router;
  let host: HTMLElement;

  const text = () => host.textContent!.replace(/\s+/g, ' ');
  const last = () => fake.calls[fake.calls.length - 1];
  const input = () => host.querySelector<HTMLInputElement>('#search-term')!;
  const cards = () => host.querySelectorAll('app-search-result-card');
  const button = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent!.includes(label))!;

  const settle = async () => {
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  const open = async (url: string) => {
    await harness.navigateByUrl(url);
    host = harness.routeNativeElement as HTMLElement;
    harness.detectChanges();
  };
  const respond = (value: SearchResponse) => {
    last().subject.next(value);
    last().subject.complete();
    harness.detectChanges();
  };
  const type = (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    harness.detectChanges();
  };
  const submit = async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };

  beforeEach(async () => {
    fake = new FakeSearchService();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'search', component: SearchPage }]), { provide: SearchService, useValue: fake }],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  it('sin término muestra el estado inicial, el input vacío y no consulta (AC-01)', async () => {
    await open('/search');

    expect(text()).toContain('Búsqueda de documentación técnica');
    expect(input().value).toBe('');
    expect(fake.calls.length).toBe(0);
    expect(host.querySelector('#search-sort')).toBeNull();
  });

  it('al enviar un término escribe q en la URL y lanza una sola consulta con el término recortado (AC-03)', async () => {
    await open('/search');

    type('  configuración de kubernetes  ');
    await submit();

    expect(router.url).toBe('/search?q=configuraci%C3%B3n%20de%20kubernetes');
    expect(fake.calls.length).toBe(1);
    expect(last().params).toEqual({ q: 'configuración de kubernetes', sort: 'relevance', page: 1 });
  });

  it('enviar el formulario vacío o solo con espacios no consulta y vuelve al estado inicial', async () => {
    await open('/search?q=helm');
    respond(response(1));

    type('   ');
    await submit();

    expect(router.url).toBe('/search');
    expect(fake.calls.length).toBe(1);
    expect(text()).toContain('Búsqueda de documentación técnica');
  });

  it('durante la consulta muestra 5 esqueletos, aria-busy y oculta orden y paginación (AC-04)', async () => {
    await open('/search?q=helm');

    expect(host.querySelectorAll('.skeleton').length).toBe(5);
    expect(host.querySelector('.search__list')!.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('#search-sort')).toBeNull();
    expect(host.querySelector('app-search-pagination')).toBeNull();
  });

  it('muestra métricas, tarjetas, orden y paginación con resultados (AC-05)', async () => {
    await open('/search?q=configuración%20de%20kubernetes');

    respond(response(24));

    expect(text()).toContain('24 resultados para «configuración de kubernetes» · 0,42 s');
    expect(cards().length).toBe(10);
    expect(host.querySelector('.search__list')!.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('#search-sort')).not.toBeNull();
    expect(text()).toContain('Mostrando 1–10 de 24');
    expect(host.querySelector('.search__metrics')!.getAttribute('aria-live')).toBe('polite');
  });

  it('SPEC-11 AC-17: los enlaces de las tarjetas llevan el término buscado como q', async () => {
    await open('/search?q=configuración%20de%20kubernetes');

    respond(response(24));

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('app-search-result-card a'));
    expect(links.length).toBe(20);
    for (const link of links) {
      const url = new URL(link.getAttribute('href')!, 'http://localhost');
      expect(url.pathname).toMatch(/^\/documents\/id-\d+$/);
      expect(url.searchParams.get('q')).toBe('configuración de kubernetes');
    }
  });

  it('usa el singular con un solo resultado y no muestra paginación', async () => {
    await open('/search?q=helm');

    respond(response(1));

    expect(text()).toContain('1 resultado para');
    expect(host.querySelector('nav')).toBeNull();
  });

  it('muestra el aviso de documentos en procesamiento solo con pendingCount > 0 (AC-07)', async () => {
    await open('/search?q=helm');
    respond(response(3, 1, { pendingCount: 2 }));
    expect(text()).toContain('Algunos documentos siguen en procesamiento y aún no aparecen en los resultados');

    await open('/search?q=zzz');
    respond(response(0, 1, { pendingCount: 2 }));
    expect(text()).toContain('Algunos documentos siguen en procesamiento');

    await open('/search?q=abc');
    respond(response(3, 1, { pendingCount: 0 }));
    expect(text()).not.toContain('siguen en procesamiento');
  });

  it('al cambiar el orden actualiza la URL, reinicia la página y consulta de nuevo (AC-08)', async () => {
    await open('/search?q=kubernetes&page=2');
    respond(response(24, 2));

    const select = host.querySelector<HTMLSelectElement>('#search-sort')!;
    select.value = 'date-desc';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(router.url).toBe('/search?q=kubernetes&sort=date-desc');
    expect(last().params).toEqual({ q: 'kubernetes', sort: 'date-desc', page: 1 });
  });

  it('marca en el selector el orden de la URL', async () => {
    await open('/search?q=kubernetes&sort=title');
    respond(response(3));

    expect(host.querySelector<HTMLSelectElement>('#search-sort')!.value).toBe('title');
  });

  it('ignora un valor de orden desconocido', async () => {
    await open('/search?q=kubernetes');
    respond(response(3));
    const navigate = spyOn(router, 'navigate');

    const select = host.querySelector<HTMLSelectElement>('#search-sort')!;
    Object.defineProperty(select, 'value', { value: 'xyz', configurable: true });
    select.dispatchEvent(new Event('change'));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('al paginar actualiza la URL, pide esa página y lleva el foco a la lista (AC-09)', async () => {
    await open('/search?q=kubernetes');
    respond(response(24));

    button('Siguiente').click();
    await settle();

    expect(router.url).toBe('/search?q=kubernetes&page=2');
    expect(last().params.page).toBe(2);
    expect(document.activeElement).toBe(host.querySelector('.search__list'));
  });

  it('corrige una página fuera de rango yendo a la última con replaceUrl (AC-10)', async () => {
    await open('/search?q=kubernetes&page=99');
    const navigate = spyOn(router, 'navigate').and.callThrough();

    respond(response(24, 99, { items: [] }));
    await settle();

    expect(navigate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ replaceUrl: true }));
    expect(router.url).toBe('/search?q=kubernetes&page=3');
    expect(last().params.page).toBe(3);
    expect(cards().length).toBe(0);
    expect(text()).not.toContain('No encontramos');
  });

  it('con total 0 muestra el estado sin resultados y «Limpiar búsqueda» vuelve al inicio (AC-11)', async () => {
    await open('/search?q=zzz');

    respond(response(0));

    expect(text()).toContain('No encontramos documentos para «zzz»');
    expect(text()).toContain('Revisa la ortografía');
    expect(host.querySelector('#search-sort')).toBeNull();

    button('Limpiar búsqueda').click();
    await settle();

    expect(router.url).toBe('/search');
    expect(input().value).toBe('');
    expect(text()).toContain('Búsqueda de documentación técnica');
  });

  it('ante un error muestra un banner genérico, conserva el término y «Reintentar» repite la consulta (AC-12)', async () => {
    await open('/search?q=kubernetes&sort=title');

    last().subject.error(GENERIC);
    harness.detectChanges();

    const alert = host.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('No se pudo completar la búsqueda');
    expect(alert.textContent).not.toMatch(/\d{3}|FTS|timeout/i);
    expect(input().value).toBe('kubernetes');

    const before = fake.calls.length;
    button('Reintentar').click();
    harness.detectChanges();

    expect(fake.calls.length).toBe(before + 1);
    expect(last().params).toEqual({ q: 'kubernetes', sort: 'title', page: 1 });
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(host.querySelectorAll('.skeleton').length).toBe(5);
  });

  it('ante un 401 no muestra ningún banner adicional', async () => {
    await open('/search?q=kubernetes');

    last().subject.error({ kind: 'unauthorized', message: 'Tu sesión expiró', retryable: false } satisfies SearchFailure);
    harness.detectChanges();

    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(text()).not.toContain('Tu sesión expiró');
  });

  it('descarta la respuesta tardía de una búsqueda anterior (AC-13)', async () => {
    await open('/search?q=uno');
    const first = last();

    type('dos');
    await submit();
    const second = last();
    expect(second).not.toBe(first);

    second.subject.next(response(2));
    second.subject.complete();
    first.subject.next(response(15));
    harness.detectChanges();

    expect(text()).toContain('2 resultados para «dos»');
    expect(text()).not.toContain('15 resultados');
    expect(first.subject.observed).toBeFalse();
  });

  it('normaliza sort y page inválidos de la URL (AC-14)', async () => {
    await open('/search?q=kubernetes&sort=xyz&page=-3');

    expect(last().params).toEqual({ q: 'kubernetes', sort: 'relevance', page: 1 });
  });

  it('el botón limpiar vacía el input, devuelve el foco y navega sin q', async () => {
    await open('/search?q=kubernetes');
    respond(response(3));

    host.querySelector<HTMLButtonElement>('.search__clear')!.click();
    await settle();

    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(router.url).toBe('/search');
    expect(host.querySelector('.search__clear')).toBeNull();
  });

  it('el input refleja q de la URL y conserva un texto sin enviar al ordenar', async () => {
    await open('/search?q=kubernetes');
    respond(response(3));
    expect(input().value).toBe('kubernetes');

    type('helm');
    const select = host.querySelector<HTMLSelectElement>('#search-sort')!;
    select.value = 'title';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(input().value).toBe('helm');
    expect(last().params.q).toBe('kubernetes');
  });

  it('cancela la consulta en vuelo al destruir la página', async () => {
    await open('/search?q=kubernetes');
    const pending = last();
    expect(pending.subject.observed).toBeTrue();

    harness.fixture.destroy();

    expect(pending.subject.observed).toBeFalse();
  });
});
