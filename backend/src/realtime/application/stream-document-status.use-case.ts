import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { filter } from 'rxjs';
import { DocumentStatusEvent } from '../domain/document-status-event';
import { DocumentStatusEvents } from './ports';

/** Eventos de estado de los documentos de un usuario; nunca los de otros. */
@Injectable()
export class StreamDocumentStatus {
  constructor(private readonly events: DocumentStatusEvents) {}

  execute(userId: string): Observable<DocumentStatusEvent> {
    return this.events.stream().pipe(filter((event) => event.ownerId === userId));
  }
}
