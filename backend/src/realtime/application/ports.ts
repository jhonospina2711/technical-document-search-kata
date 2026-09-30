import type { Observable } from 'rxjs';
import { DocumentStatusEvent } from '../domain/document-status-event';

/** Difusor de avisos de estado dentro de esta instancia del API. */
export abstract class DocumentStatusEvents {
  /** Reparte el evento a quienes estén suscritos en ese momento; sin buffer ni reenvío. */
  abstract emit(event: DocumentStatusEvent): void;
  /** Flujo de todos los eventos; se completa al apagar la aplicación. */
  abstract stream(): Observable<DocumentStatusEvent>;
}
