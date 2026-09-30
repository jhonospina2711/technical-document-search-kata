import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export type PageItem = number | 'ellipsis';

/**
 * Ventana de paginación: primera, última y la actual ±1. Un hueco de una sola página se rellena con
 * ese número (una elipsis no ahorraría espacio); uno mayor se resume con `'ellipsis'`.
 */
export function pageWindow(current: number, last: number): PageItem[] {
  const pages = [...new Set([1, current - 1, current, current + 1, last])]
    .filter((page) => page >= 1 && page <= last)
    .sort((a, b) => a - b);

  const items: PageItem[] = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined) {
      const gap = page - previous;
      if (gap === 2) {
        items.push(previous + 1);
      } else if (gap > 2) {
        items.push('ellipsis');
      }
    }
    items.push(page);
  });
  return items;
}

/** Paginación numerada de resultados. Presentacional: emite la página pedida y no navega por sí sola. */
@Component({
  selector: 'app-search-pagination',
  templateUrl: './search-pagination.html',
  styleUrl: './search-pagination.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPagination {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();

  readonly pageChange = output<number>();

  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  /** Página mostrada: una fuera de rango se acota para que el texto y los botones sigan siendo coherentes. */
  protected readonly current = computed(() => Math.min(Math.max(1, this.page()), this.lastPage()));
  protected readonly items = computed(() => pageWindow(this.current(), this.lastPage()));
  protected readonly from = computed(() => (this.current() - 1) * this.pageSize() + 1);
  protected readonly to = computed(() => Math.min(this.current() * this.pageSize(), this.total()));

  protected goTo(page: number): void {
    if (page !== this.current() && page >= 1 && page <= this.lastPage()) {
      this.pageChange.emit(page);
    }
  }
}
