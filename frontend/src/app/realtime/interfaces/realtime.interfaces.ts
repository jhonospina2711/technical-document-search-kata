/** Estados finales que el Worker notifica (SPEC-14 FR-02). */
export type FinalDocumentStatus = 'PROCESADO' | 'ERROR';

/** Contrato del evento `document-status` de `GET /realtime/events`; el `data` SSE no incluye `ownerId`. */
export interface DocumentStatusEvent {
  type: 'DOCUMENT_STATUS_CHANGED';
  documentId: string;
  status: FinalDocumentStatus;
}

/** Señales que emite el cliente SSE: conexión abierta, evento de estado válido o conexión caída (se reintenta). */
export type RealtimeSignal =
  | { kind: 'open' }
  | { kind: 'status'; event: DocumentStatusEvent }
  | { kind: 'lost' };
