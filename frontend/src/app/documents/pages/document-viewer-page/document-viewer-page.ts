import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, WritableSignal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { DocumentMetadataPanel } from '../../components/document-metadata-panel/document-metadata-panel';
import { DocumentDetail } from '../../interfaces/document.interfaces';
import { DocumentLoadFailure, DocumentsService } from '../../services/documents.service';
import { formatUtc } from '../../utils/format-utc';
import { splitHighlights, wordCount } from '../../utils/highlight-segments';

type ViewerState = 'loading' | 'loaded' | 'notFound' | 'failure';

/** Lo que la pantalla muestra; `document` solo existe en `loaded` y `failure` solo en `failure`. */
interface ViewerView {
  state: ViewerState;
  document: DocumentDetail | null;
  failure: DocumentLoadFailure | null;
  /** `true` mientras "Actualizar" vuelve a consultar: la vista anterior se conserva. */
  refreshing: boolean;
}

interface LoadRequest {
  id: string;
  refresh: boolean;
}

type Outcome = { document: DocumentDetail } | { failure: DocumentLoadFailure };

const LOADING: ViewerView = { state: 'loading', document: null, failure: null, refreshing: false };
const NOT_FOUND: ViewerView = { state: 'notFound', document: null, failure: null, refreshing: false };

const FEEDBACK_MS = 2000;
// `Intl` con `es` no agrupa los miles de números de cuatro cifras ("4820"); el visor los muestra como "4.820".
const formatCount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Visor de un documento. El `id` de la ruta es la fuente de la consulta; `?q=` solo se lee para resaltar el
 * texto y no la repite. El contenido es texto plano de usuario: se pinta siempre por interpolación.
 */
@Component({
  selector: 'app-document-viewer-page',
  imports: [RouterLink, DocumentMetadataPanel],
  templateUrl: './document-viewer-page.html',
  styleUrl: './document-viewer-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentViewerPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly documents = inject(DocumentsService);

  private readonly requests = new Subject<LoadRequest>();
  private readonly timers = new Map<WritableSignal<string | null>, ReturnType<typeof setTimeout>>();
  private id = '';
  /** Llegó desde otra pantalla de la app (p. ej. la búsqueda): "Volver" usa el historial. */
  private readonly hasHistory = this.router.currentNavigation()?.previousNavigation != null;

  protected readonly view = signal<ViewerView>(LOADING);
  protected readonly skeletonLines = Array.from({ length: 12 }, (_, i) => i);
  protected readonly fieldSkeletons = [1, 2, 3, 4, 5, 6];
  protected readonly contentFeedback = signal<string | null>(null);
  protected readonly idFeedback = signal<string | null>(null);
  protected readonly refreshFeedback = signal<string | null>(null);

  private readonly q = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')), {
    requireSync: true,
  });

  private readonly content = computed(() => this.view().document?.content ?? '');
  protected readonly hasContent = computed(() => this.content().length > 0);
  protected readonly segments = computed(() => splitHighlights(this.content(), this.q()));
  protected readonly charCount = computed(() => formatCount(this.content().length));
  protected readonly wordCount = computed(() => formatCount(wordCount(this.content())));
  protected readonly createdAt = computed(() => formatUtc(this.view().document?.createdAt ?? ''));

  protected readonly backHref = computed(() => {
    const q = this.q();
    const tree = this.router.createUrlTree(['/search'], { queryParams: q ? { q } : {} });
    return this.location.prepareExternalUrl(this.router.serializeUrl(tree));
  });

  constructor() {
    this.requests
      .pipe(
        tap(({ refresh }) => this.startLoading(refresh)),
        switchMap(({ id }) =>
          this.documents.getById(id).pipe(
            map((document): Outcome => ({ document })),
            catchError((failure: DocumentLoadFailure) => of<Outcome>({ failure })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => this.apply(outcome));

    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((id) => {
        this.id = id;
        this.requests.next({ id, refresh: false });
      });

    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  protected retry(): void {
    this.requests.next({ id: this.id, refresh: false });
  }

  protected refresh(): void {
    if (this.view().refreshing) {
      return;
    }
    this.requests.next({ id: this.id, refresh: true });
  }

  protected copyContent(): void {
    void this.copy(this.content(), this.contentFeedback);
  }

  protected copyId(): void {
    void this.copy(this.view().document?.id ?? '', this.idFeedback);
  }

  protected onBack(event: Event): void {
    event.preventDefault();
    if (this.hasHistory) {
      this.location.back();
    } else {
      void this.router.navigateByUrl(this.backHref());
    }
  }

  private startLoading(refresh: boolean): void {
    this.refreshFeedback.set(null);
    this.view.update((view) => (refresh && view.state === 'loaded' ? { ...view, refreshing: true } : LOADING));
  }

  private apply(outcome: Outcome): void {
    if ('document' in outcome) {
      this.view.set({ state: 'loaded', document: outcome.document, failure: null, refreshing: false });
      return;
    }
    const { failure } = outcome;
    if (this.view().refreshing && failure.kind === 'server') {
      // Falló "Actualizar": se conserva lo que ya se mostraba.
      this.view.update((view) => ({ ...view, refreshing: false }));
      this.flash(this.refreshFeedback, 'No se pudo actualizar');
      return;
    }
    this.view.set(
      failure.kind === 'not-found' ? NOT_FOUND : { state: 'failure', document: null, failure, refreshing: false },
    );
  }

  private async copy(text: string, target: WritableSignal<string | null>): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.flash(target, 'Copiado');
    } catch {
      this.flash(target, 'No se pudo copiar');
    }
  }

  private flash(target: WritableSignal<string | null>, message: string): void {
    clearTimeout(this.timers.get(target));
    target.set(message);
    this.timers.set(
      target,
      setTimeout(() => target.set(null), FEEDBACK_MS),
    );
  }
}
