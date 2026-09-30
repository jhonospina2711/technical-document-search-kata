import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, mergeMap, of, scan, startWith, takeWhile } from 'rxjs';
import { FinalDocumentStatus } from '../../realtime/interfaces/realtime.interfaces';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { DocumentStatus } from '../interfaces/document.interfaces';
import { DocumentsService } from './documents.service';

/** Estado del documento seguido y si el seguimiento en vivo está conectado ahora mismo. */
export interface TrackedStatus {
  status: DocumentStatus;
  live: boolean;
}

type Update = { live: boolean } | { final: FinalDocumentStatus };

const INITIAL: TrackedStatus = { status: 'PROCESANDO', live: false };

/** Sigue un documento hasta su estado final combinando el stream SSE con una reconciliación REST por conexión. */
@Injectable({ providedIn: 'root' })
export class DocumentStatusTracker {
  private readonly realtime = inject(RealtimeService);
  private readonly documents = inject(DocumentsService);

  /**
   * Emite `PROCESANDO` al suscribirse y cada cambio de estado o de conexión; al llegar a `PROCESADO` o `ERROR`
   * emite ese valor y completa, lo que cierra la conexión SSE. Las consultas REST no son periódicas: hay una
   * por cada conexión establecida, para recuperar eventos que el servidor no reenvía.
   */
  track(documentId: string): Observable<TrackedStatus> {
    return this.realtime.connect().pipe(
      mergeMap((signal): Observable<Update> => {
        switch (signal.kind) {
          case 'open':
            return this.reconcile(documentId).pipe(startWith<Update>({ live: true }));
          case 'status':
            return signal.event.documentId === documentId ? of({ final: signal.event.status }) : EMPTY;
          case 'lost':
            return of({ live: false });
        }
      }),
      scan(
        (state, update): TrackedStatus =>
          'final' in update ? { status: update.final, live: false } : { ...state, live: update.live },
        INITIAL,
      ),
      startWith(INITIAL),
      takeWhile((state) => state.status === 'PROCESANDO', true),
    );
  }

  /** Emite el estado final si el documento ya lo alcanzó; un fallo de la consulta se ignora y se sigue con el stream. */
  private reconcile(documentId: string): Observable<Update> {
    return this.documents.getById(documentId).pipe(
      mergeMap(({ status }): Observable<Update> => (status === 'PROCESANDO' ? EMPTY : of({ final: status }))),
      catchError(() => EMPTY),
    );
  }
}
