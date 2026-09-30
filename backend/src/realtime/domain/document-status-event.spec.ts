import { DOCUMENT_STATUS_CHANGED, DocumentStatusEvent, parseStatusEvent, toStatusMessage } from './document-status-event';

const event: DocumentStatusEvent = {
  documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ownerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PROCESADO',
};

describe('document-status-event', () => {
  it('serializa con el tipo del evento y se puede volver a leer', () => {
    const body = JSON.parse(toStatusMessage(event)) as unknown;

    expect(body).toEqual({ type: DOCUMENT_STATUS_CHANGED, ...event });
    expect(parseStatusEvent(body)).toEqual(event);
  });

  it('acepta el estado ERROR', () => {
    expect(parseStatusEvent({ type: DOCUMENT_STATUS_CHANGED, ...event, status: 'ERROR' })?.status).toBe('ERROR');
  });

  it('descarta campos ajenos al contrato', () => {
    const parsed = parseStatusEvent({ type: DOCUMENT_STATUS_CHANGED, ...event, content: 'secreto' });

    expect(parsed).toEqual(event);
  });

  it.each([
    ['null', null],
    ['texto', 'DOCUMENT_STATUS_CHANGED'],
    ['tipo desconocido', { type: 'OTRO', ...event }],
    ['sin tipo', { ...event }],
    ['documentId no uuid', { type: DOCUMENT_STATUS_CHANGED, ...event, documentId: '123' }],
    ['documentId numérico', { type: DOCUMENT_STATUS_CHANGED, ...event, documentId: 5 }],
    ['ownerId no uuid', { type: DOCUMENT_STATUS_CHANGED, ...event, ownerId: 'abc' }],
    ['estado PROCESANDO', { type: DOCUMENT_STATUS_CHANGED, ...event, status: 'PROCESANDO' }],
    ['estado INDEXED', { type: DOCUMENT_STATUS_CHANGED, ...event, status: 'INDEXED' }],
  ])('rechaza un mensaje inválido: %s', (_name, body) => {
    expect(parseStatusEvent(body)).toBeNull();
  });
});
