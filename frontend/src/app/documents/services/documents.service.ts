import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, filter, map, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DocumentMetadata, UploadedDocument, UploadProgress } from '../interfaces/document.interfaces';
import { formatBytes } from '../validators/file-validation';

export type UploadEvent =
  | ({ type: 'progress' } & UploadProgress)
  | { type: 'done'; document: UploadedDocument };

/**
 * `file`: el archivo fue rechazado (400/413); `fields`: fallo de validación de metadata (400 con lista);
 * `server`: red, 503 o 5xx; `unauthorized`: 401 (la sesión ya la cierra `authInterceptor`).
 */
export type UploadFailureKind = 'file' | 'fields' | 'server' | 'unauthorized';

export interface UploadFailure {
  kind: UploadFailureKind;
  message: string;
  retryable: boolean;
}

const SERVER_FAILURE: UploadFailure = {
  kind: 'server',
  message: 'No se pudo completar la carga. Inténtalo de nuevo',
  retryable: true,
};

/** Traduce el error HTTP de POST /documents a un fallo de UI con mensaje en español. */
export function mapUploadError(error: unknown): UploadFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return SERVER_FAILURE;
  }
  const message: unknown = error.error?.message;
  switch (error.status) {
    case 0:
      return {
        kind: 'server',
        message: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo',
        retryable: true,
      };
    case 400:
      if (Array.isArray(message)) {
        return { kind: 'fields', message: message.join('. '), retryable: false };
      }
      return {
        kind: 'file',
        message: typeof message === 'string' ? message : 'La solicitud no es válida',
        retryable: false,
      };
    case 401:
      return { kind: 'unauthorized', message: 'Tu sesión expiró. Inicia sesión de nuevo', retryable: false };
    case 413:
      return {
        kind: 'file',
        message:
          typeof message === 'string'
            ? message
            : `El archivo supera el tamaño máximo permitido (${formatBytes(environment.maxFileSizeBytes)})`,
        retryable: false,
      };
    case 503:
      return {
        kind: 'server',
        message: 'El servicio no pudo registrar el documento. Reintenta en unos segundos',
        retryable: true,
      };
    default:
      return SERVER_FAILURE;
  }
}

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/documents`;

  /** Envía el archivo y la metadata; emite el progreso de subida y, al final, el documento creado. */
  upload(file: File, metadata: DocumentMetadata): Observable<UploadEvent> {
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('title', metadata.title.trim());
    body.append('author', metadata.author.trim());
    body.append('category', metadata.category.trim());
    body.append('version', metadata.version.trim());
    body.append('tags', metadata.tags.map((tag) => tag.trim()).join(','));

    return this.http.post<UploadedDocument>(this.baseUrl, body, { reportProgress: true, observe: 'events' }).pipe(
      map((event) => this.toUploadEvent(event)),
      filter((event): event is UploadEvent => event !== null),
      catchError((error: unknown) => throwError(() => mapUploadError(error))),
    );
  }

  private toUploadEvent(event: HttpEvent<UploadedDocument>): UploadEvent | null {
    if (event.type === HttpEventType.UploadProgress) {
      const total = event.total ?? 0;
      const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
      return { type: 'progress', percent, loaded: event.loaded, total };
    }
    if (event.type === HttpEventType.Response) {
      const document = event.body;
      if (!document || typeof document.id !== 'string' || !document.id) {
        throw new HttpErrorResponse({ status: 500, url: event.url ?? undefined });
      }
      return { type: 'done', document };
    }
    return null;
  }
}
