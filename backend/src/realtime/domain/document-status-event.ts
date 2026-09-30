import { DocumentStatus } from '../../documents/domain/document';

export const DOCUMENT_STATUS_CHANGED = 'DOCUMENT_STATUS_CHANGED';

/** Estados finales: los únicos que se notifican. */
export type NotifiedStatus = typeof DocumentStatus.PROCESADO | typeof DocumentStatus.ERROR;

export interface DocumentStatusEvent {
  documentId: string;
  ownerId: string;
  status: NotifiedStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mensaje de `documents.status` tal como viaja por RabbitMQ. */
export function toStatusMessage(event: DocumentStatusEvent): string {
  return JSON.stringify({ type: DOCUMENT_STATUS_CHANGED, ...event });
}

/** Valida un cuerpo ya deserializado; `null` si no cumple el contrato. */
export function parseStatusEvent(body: unknown): DocumentStatusEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const { type, documentId, ownerId, status } = body as Record<string, unknown>;
  if (type !== DOCUMENT_STATUS_CHANGED) return null;
  if (typeof documentId !== 'string' || !UUID.test(documentId)) return null;
  if (typeof ownerId !== 'string' || !UUID.test(ownerId)) return null;
  if (status !== DocumentStatus.PROCESADO && status !== DocumentStatus.ERROR) return null;
  return { documentId, ownerId, status };
}
