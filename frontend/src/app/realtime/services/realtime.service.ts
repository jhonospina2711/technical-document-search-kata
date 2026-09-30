import { Injectable, inject } from '@angular/core';
import { Observable, Subscription, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';
import { DocumentStatusEvent, RealtimeSignal } from '../interfaces/realtime.interfaces';
import { createSseParser, SseFrame } from '../utils/sse-parser';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
/** Dos latidos del servidor (25 s) más margen: sin bytes durante este tiempo la conexión se da por muerta. */
const IDLE_TIMEOUT_MS = 60_000;

/** Espera antes del reintento `attempt` (0 = primero): 1, 2, 4, 8, 16 s y tope de 30 s. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

function toStatusEvent(frame: SseFrame): DocumentStatusEvent | null {
  if (frame.event !== 'document-status') return null;
  let value: unknown;
  try {
    value = JSON.parse(frame.data);
  } catch {
    return null;
  }
  const { type, documentId, status } = (value ?? {}) as Record<string, unknown>;
  if (type !== 'DOCUMENT_STATUS_CHANGED' || typeof documentId !== 'string' || !documentId) return null;
  if (status !== 'PROCESADO' && status !== 'ERROR') return null;
  return { type, documentId, status };
}

/** Cliente de `GET /realtime/events`: `fetch` en streaming (permite `Authorization`, que `EventSource` no) con reconexión. */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}/realtime/events`;

  /**
   * Flujo frío: conecta al suscribirse y cierra la conexión y los temporizadores al desuscribirse.
   * Reintenta sin límite con backoff; un `401` cierra la sesión y completa; sin token falla con error.
   */
  connect(): Observable<RealtimeSignal> {
    return new Observable<RealtimeSignal>((subscriber) => {
      let closed = false;
      let attempt = 0;
      let controller: AbortController | undefined;
      let retry: Subscription | undefined;

      const run = async (): Promise<void> => {
        const token = this.auth.token();
        if (!token) {
          subscriber.error(new Error('Sin sesión activa'));
          return;
        }

        const current = new AbortController();
        controller = current;
        let watchdog: Subscription | undefined;
        const armWatchdog = () => {
          watchdog?.unsubscribe();
          watchdog = timer(IDLE_TIMEOUT_MS).subscribe(() => current.abort());
        };

        armWatchdog();
        try {
          const response = await fetch(this.url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            signal: current.signal,
          });
          if (closed) return;
          if (response.status === 401) {
            this.auth.logout();
            subscriber.complete();
            return;
          }
          const isEventStream = response.headers.get('Content-Type')?.startsWith('text/event-stream') ?? false;
          if (!response.ok || !isEventStream || !response.body) {
            throw new Error(`Respuesta inesperada (${response.status})`);
          }

          attempt = 0;
          subscriber.next({ kind: 'open' });
          armWatchdog();

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const parser = createSseParser();
          for (;;) {
            const { done, value } = await reader.read();
            if (done || closed) break;
            armWatchdog();
            for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
              const event = toStatusEvent(frame);
              if (event) subscriber.next({ kind: 'status', event });
            }
          }
        } catch {
          // Red, abortos del vigilante o lectura rota: se trata igual que un cierre y se reintenta.
        } finally {
          watchdog?.unsubscribe();
        }

        if (closed) return;
        subscriber.next({ kind: 'lost' });
        retry = timer(backoffDelayMs(attempt++)).subscribe(() => void run());
      };

      void run();

      return () => {
        closed = true;
        retry?.unsubscribe();
        controller?.abort();
      };
    });
  }
}
