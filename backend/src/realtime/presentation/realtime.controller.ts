import { Controller, Logger, MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import { finalize, interval, map, merge, Observable } from 'rxjs';
import { AuthGuard } from '../../auth/presentation/auth.guard';
import { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { requestIdOf } from '../../common/request-id';
import { StreamDocumentStatus } from '../application/stream-document-status.use-case';
import { DOCUMENT_STATUS_CHANGED, DocumentStatusEvent } from '../domain/document-status-event';

/** Cada cuánto se envía un latido para que proxies y balanceadores no cierren la conexión inactiva. */
export const HEARTBEAT_INTERVAL_MS = 25000;

@Controller('realtime')
@UseGuards(AuthGuard)
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(private readonly streamDocumentStatus: StreamDocumentStatus) {}

  /**
   * Stream SSE con los cambios de estado de los documentos del usuario autenticado. Nest fija las
   * cabeceras del stream y cancela la suscripción cuando el cliente cierra la conexión.
   */
  @Sse('events')
  events(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    const requestId = requestIdOf(req);
    this.logger.log(`[${requestId}] stream de estado abierto`);
    const statuses = this.streamDocumentStatus.execute(req.user.id).pipe(map(toStatusMessage));
    const heartbeats = interval(HEARTBEAT_INTERVAL_MS).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: {} })));
    return merge(statuses, heartbeats).pipe(
      finalize(() => this.logger.log(`[${requestId}] stream de estado cerrado`)),
    );
  }
}

/** El `ownerId` no sale del servidor: el cliente solo recibe el documento y su nuevo estado. */
function toStatusMessage(event: DocumentStatusEvent): MessageEvent {
  return {
    type: 'document-status',
    data: { type: DOCUMENT_STATUS_CHANGED, documentId: event.documentId, status: event.status },
  };
}
