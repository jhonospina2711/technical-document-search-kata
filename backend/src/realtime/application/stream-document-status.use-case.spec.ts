import { Subject } from 'rxjs';
import { DocumentStatusEvent } from '../domain/document-status-event';
import { DocumentStatusEvents } from './ports';
import { StreamDocumentStatus } from './stream-document-status.use-case';

const ada = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const grace = '9b2f5c1e-3d4a-4f6b-8a1c-2e7d9f0a1b3c';
const eventOf = (ownerId: string, status: DocumentStatusEvent['status'] = 'PROCESADO'): DocumentStatusEvent => ({
  documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ownerId,
  status,
});

describe('StreamDocumentStatus', () => {
  let source: Subject<DocumentStatusEvent>;
  let useCase: StreamDocumentStatus;

  beforeEach(() => {
    source = new Subject<DocumentStatusEvent>();
    const events: DocumentStatusEvents = { emit: (event) => source.next(event), stream: () => source.asObservable() };
    useCase = new StreamDocumentStatus(events);
  });

  it('entrega solo los eventos del usuario (AC-03)', () => {
    const received: DocumentStatusEvent[] = [];
    useCase.execute(ada).subscribe((event) => received.push(event));

    source.next(eventOf(grace));
    source.next(eventOf(ada, 'ERROR'));

    expect(received).toEqual([eventOf(ada, 'ERROR')]);
  });

  it('todas las conexiones del mismo usuario reciben el evento y las de otro no', () => {
    const tabs: DocumentStatusEvent[][] = [[], []];
    const other: DocumentStatusEvent[] = [];
    useCase.execute(ada).subscribe((event) => tabs[0].push(event));
    useCase.execute(ada).subscribe((event) => tabs[1].push(event));
    useCase.execute(grace).subscribe((event) => other.push(event));

    source.next(eventOf(ada));

    expect(tabs).toEqual([[eventOf(ada)], [eventOf(ada)]]);
    expect(other).toEqual([]);
  });

  it('se completa cuando se completa el difusor', () => {
    let completed = false;
    useCase.execute(ada).subscribe({ complete: () => (completed = true) });

    source.complete();

    expect(completed).toBe(true);
  });
});
