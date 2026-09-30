import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { Subject } from 'rxjs';
import { DocumentStatusEvents } from '../application/ports';
import { DocumentStatusEvent } from '../domain/document-status-event';

/**
 * Difusor en memoria. Un `Subject` sin buffer: un suscriptor lento no bloquea a los demás ni al
 * emisor, y quien no está suscrito cuando llega el evento no lo recibe.
 */
@Injectable()
export class InMemoryDocumentStatusEvents extends DocumentStatusEvents implements OnModuleDestroy {
  private readonly subject = new Subject<DocumentStatusEvent>();

  emit(event: DocumentStatusEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<DocumentStatusEvent> {
    return this.subject.asObservable();
  }

  /** Completa los flujos abiertos para que el cierre ordenado no espere a las conexiones. */
  onModuleDestroy(): void {
    this.subject.complete();
  }
}
