import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SearchResultItem } from '../../interfaces/search.interfaces';

const DATE_FORMAT = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' });

/** Tarjeta de un resultado de búsqueda. Presentacional: todo el texto se interpola, nunca se inyecta como HTML. */
@Component({
  selector: 'app-search-result-card',
  imports: [RouterLink],
  templateUrl: './search-result-card.html',
  styleUrl: './search-result-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultCard {
  readonly item = input.required<SearchResultItem>();
  /** Término con el que se buscó; el visor lo usa para resaltar. Vacío: el enlace no lleva `q`. */
  readonly term = input('');

  protected readonly documentLink = computed(() => ['/documents', this.item().id]);
  protected readonly documentQuery = computed(() => (this.term() ? { q: this.term() } : {}));
  /** Relevancia como porcentaje entero; acota puntuaciones fuera de [0, 1]. */
  protected readonly percent = computed(() => Math.round(Math.min(1, Math.max(0, this.item().score || 0)) * 100));
  protected readonly date = computed(() => {
    const date = new Date(this.item().createdAt);
    return Number.isNaN(date.getTime()) ? null : { iso: date.toISOString(), label: DATE_FORMAT.format(date) };
  });
}
