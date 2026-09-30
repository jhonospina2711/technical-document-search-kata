import { DocumentStatusEvent } from '../domain/document-status-event';
import { InMemoryDocumentStatusEvents } from './in-memory-document-status-events';

const event: DocumentStatusEvent = {
  documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ownerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PROCESADO',
};

describe('InMemoryDocumentStatusEvents', () => {
  let events: InMemoryDocumentStatusEvents;

  beforeEach(() => {
    events = new InMemoryDocumentStatusEvents();
  });

  it('reparte el evento a todos los suscriptores', () => {
    const first: DocumentStatusEvent[] = [];
    const second: DocumentStatusEvent[] = [];
    events.stream().subscribe((e) => first.push(e));
    events.stream().subscribe((e) => second.push(e));

    events.emit(event);

    expect(first).toEqual([event]);
    expect(second).toEqual([event]);
  });

  it('no guarda eventos: quien se suscribe después no los recibe', () => {
    events.emit(event);
    const late: DocumentStatusEvent[] = [];

    events.stream().subscribe((e) => late.push(e));

    expect(late).toEqual([]);
  });

  it('un suscriptor que cancela deja de recibir y no afecta a los demás (AC-07)', () => {
    const kept: DocumentStatusEvent[] = [];
    const dropped: DocumentStatusEvent[] = [];
    events.stream().subscribe((e) => kept.push(e));
    const subscription = events.stream().subscribe((e) => dropped.push(e));

    subscription.unsubscribe();
    events.emit(event);

    expect(kept).toEqual([event]);
    expect(dropped).toEqual([]);
  });

  it('al apagar completa los flujos abiertos', () => {
    let completed = false;
    events.stream().subscribe({ complete: () => (completed = true) });

    events.onModuleDestroy();

    expect(completed).toBe(true);
  });
});
