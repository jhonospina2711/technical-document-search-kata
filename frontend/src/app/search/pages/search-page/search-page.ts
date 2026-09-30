import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  mergeMap,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { SearchPagination } from '../../components/search-pagination/search-pagination';
import { SearchResultCard } from '../../components/search-result-card/search-result-card';
import {
  SEARCH_PAGE_SIZE,
  SearchParams,
  SearchResponse,
  SearchSort,
} from '../../interfaces/search.interfaces';
import { SearchFailure, SearchService } from '../../services/search.service';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_SORTS, parseSearchParams } from '../../utils/search-params';

type SearchState = 'initial' | 'loading' | 'results' | 'empty' | 'error';

/** Lo que la pantalla muestra en cada momento; `response` y `failure` solo existen en los estados que los usan. */
interface SearchView {
  state: SearchState;
  q: string;
  response: SearchResponse | null;
  failure: SearchFailure | null;
}

const INITIAL: SearchView = { state: 'initial', q: '', response: null, failure: null };
const LOADING: SearchView = { state: 'loading', q: '', response: null, failure: null };

const SECONDS = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sameParams = (a: SearchParams, b: SearchParams) => a.q === b.q && a.sort === b.sort && a.page === b.page;

/**
 * Pantalla de búsqueda. La URL (`q`, `sort`, `page`) es la única fuente de verdad: enviar el formulario,
 * ordenar o paginar solo navega, y la consulta se lanza al cambiar los parámetros.
 */
@Component({
  selector: 'app-search-page',
  imports: [ReactiveFormsModule, SearchResultCard, SearchPagination],
  templateUrl: './search-page.html',
  styleUrl: './search-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly searchService = inject(SearchService);

  protected readonly sorts = SEARCH_SORTS;
  protected readonly maxLength = SEARCH_QUERY_MAX_LENGTH;
  protected readonly pageSize = SEARCH_PAGE_SIZE;
  protected readonly skeletons = [1, 2, 3, 4, 5];
  protected readonly term = new FormControl('', { nonNullable: true });
  protected readonly termValue = toSignal(this.term.valueChanges, { initialValue: this.term.value });

  private readonly params$ = this.route.queryParamMap.pipe(map(parseSearchParams), distinctUntilChanged(sameParams));
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  protected readonly params = toSignal(this.params$, { requireSync: true });
  protected readonly view = toSignal(
    combineLatest([this.params$, this.retry$]).pipe(switchMap(([params]) => this.load(params))),
    { requireSync: true },
  );

  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('termInput');

  constructor() {
    // El input refleja el término de la URL solo cuando este cambia: un texto aún sin enviar sobrevive a ordenar o paginar.
    this.params$
      .pipe(
        map((params) => params.q),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((q) => this.term.setValue(q));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.navigate({ ...this.params(), q: this.term.value.trim(), page: 1 });
  }

  protected clear(): void {
    this.term.setValue('');
    this.input().nativeElement.focus();
    this.navigate({ ...this.params(), q: '', page: 1 });
  }

  protected retry(): void {
    this.retry$.next();
  }

  protected onSortChange(event: Event): void {
    const sort = (event.target as HTMLSelectElement).value as SearchSort;
    if (SEARCH_SORTS.some((option) => option.value === sort)) {
      this.navigate({ ...this.params(), sort, page: 1 });
    }
  }

  protected onPageChange(page: number): void {
    this.navigate({ ...this.params(), page });
    const list = this.list().nativeElement;
    list.focus();
    list.scrollIntoView?.({ block: 'start' });
  }

  protected seconds(milliseconds: number): string {
    return SECONDS.format(milliseconds / 1000);
  }

  private load(params: SearchParams): Observable<SearchView> {
    if (!params.q) {
      return of(INITIAL);
    }
    return this.searchService.search(params).pipe(
      mergeMap((response) => {
        const lastPage = Math.max(1, Math.ceil(response.total / response.pageSize));
        if (response.total > 0 && params.page > lastPage) {
          // Página fuera de rango: se corrige la URL y esa navegación lanza la consulta correcta.
          this.navigate({ ...params, page: lastPage }, true);
          return EMPTY;
        }
        const state: SearchState = response.total === 0 ? 'empty' : 'results';
        return of<SearchView>({ state, q: params.q, response, failure: null });
      }),
      startWith(LOADING),
      catchError((failure: SearchFailure) => of<SearchView>({ state: 'error', q: params.q, response: null, failure })),
    );
  }

  /** Escribe los parámetros en la URL omitiendo los valores por defecto. */
  private navigate(params: SearchParams, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: params.q || null,
        sort: params.sort === 'relevance' ? null : params.sort,
        page: params.page === 1 ? null : params.page,
      },
      replaceUrl,
    });
  }
}
