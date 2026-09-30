import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RealtimeSignal } from '../../realtime/interfaces/realtime.interfaces';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { DocumentDetail } from '../interfaces/document.interfaces';
import { DocumentStatusTracker, TrackedStatus } from './document-status-tracker';
import { DocumentsService } from './documents.service';

/** El tracker solo lee `status` del detalle que devuelve `DocumentsService.getById`. */
type DocumentStatusSnapshot = Pick<DocumentDetail, 'id' | 'status'>;

describe('DocumentStatusTracker', () => {
  const ID = 'doc-1';
  let signals: Subject<RealtimeSignal>;
  let snapshots: Subject<DocumentStatusSnapshot>[];
  let getById: jasmine.Spy;
  let emitted: TrackedStatus[];
  let completed: boolean;
  let errors: unknown[];

  const status = (documentId: string, value: 'PROCESADO' | 'ERROR'): RealtimeSignal => ({
    kind: 'status',
    event: { type: 'DOCUMENT_STATUS_CHANGED', documentId, status: value },
  });

  beforeEach(() => {
    signals = new Subject<RealtimeSignal>();
    snapshots = [];
    getById = jasmine.createSpy('getById').and.callFake(() => {
      const snapshot = new Subject<DocumentStatusSnapshot>();
      snapshots.push(snapshot);
      return snapshot;
    });
    emitted = [];
    completed = false;
    errors = [];

    TestBed.configureTestingModule({
      providers: [
        { provide: RealtimeService, useValue: { connect: () => signals } },
        { provide: DocumentsService, useValue: { getById } },
      ],
    });
    TestBed.inject(DocumentStatusTracker)
      .track(ID)
      .subscribe({
        next: (state) => emitted.push(state),
        error: (error) => errors.push(error),
        complete: () => (completed = true),
      });
  });

  it('emite PROCESANDO sin conexión en vivo al suscribirse y abre el stream', () => {
    expect(emitted).toEqual([{ status: 'PROCESANDO', live: false }]);
    expect(signals.observed).toBeTrue();
  });

  it('marca live al abrir la conexión y consulta el documento una vez (AC-04)', () => {
    signals.next({ kind: 'open' });

    expect(emitted.at(-1)).toEqual({ status: 'PROCESANDO', live: true });
    expect(getById).toHaveBeenCalledOnceWith(ID);
  });

  it('si al conectar el documento ya terminó, emite el estado final y completa (AC-04)', () => {
    signals.next({ kind: 'open' });
    snapshots[0].next({ id: ID, status: 'PROCESADO' });

    expect(emitted.at(-1)).toEqual({ status: 'PROCESADO', live: false });
    expect(completed).toBeTrue();
    expect(signals.observed).toBeFalse();
  });

  it('si al conectar el documento sigue PROCESANDO, no cambia el estado', () => {
    signals.next({ kind: 'open' });
    snapshots[0].next({ id: ID, status: 'PROCESANDO' });

    expect(emitted).toEqual([
      { status: 'PROCESANDO', live: false },
      { status: 'PROCESANDO', live: true },
    ]);
    expect(completed).toBeFalse();
  });

  it('emite PROCESADO al llegar el evento del documento y cierra el stream (AC-01)', () => {
    signals.next({ kind: 'open' });
    signals.next(status(ID, 'PROCESADO'));

    expect(emitted.at(-1)).toEqual({ status: 'PROCESADO', live: false });
    expect(completed).toBeTrue();
    expect(signals.observed).toBeFalse();
  });

  it('emite ERROR al llegar el evento del documento (AC-02)', () => {
    signals.next({ kind: 'open' });
    signals.next(status(ID, 'ERROR'));

    expect(emitted.at(-1)).toEqual({ status: 'ERROR', live: false });
    expect(completed).toBeTrue();
  });

  it('ignora los eventos de otros documentos', () => {
    signals.next({ kind: 'open' });
    signals.next(status('otro', 'PROCESADO'));

    expect(emitted.at(-1)).toEqual({ status: 'PROCESANDO', live: true });
    expect(completed).toBeFalse();
  });

  it('live sigue a open y lost, y reconcilia de nuevo en cada reconexión (AC-05)', () => {
    signals.next({ kind: 'open' });
    signals.next({ kind: 'lost' });
    expect(emitted.at(-1)).toEqual({ status: 'PROCESANDO', live: false });

    signals.next({ kind: 'open' });
    expect(emitted.at(-1)).toEqual({ status: 'PROCESANDO', live: true });
    expect(getById).toHaveBeenCalledTimes(2);
  });

  it('ignora un fallo de la reconciliación y sigue esperando eventos', () => {
    signals.next({ kind: 'open' });
    snapshots[0].error(new Error('404'));

    expect(errors).toEqual([]);
    expect(completed).toBeFalse();
    signals.next(status(ID, 'PROCESADO'));
    expect(emitted.at(-1)).toEqual({ status: 'PROCESADO', live: false });
  });

  it('cancela la consulta en vuelo cuando el evento llega antes (AC-07)', () => {
    signals.next({ kind: 'open' });
    signals.next(status(ID, 'PROCESADO'));

    expect(snapshots[0].observed).toBeFalse();
  });

  it('no emite nada después del estado final', () => {
    signals.next({ kind: 'open' });
    signals.next(status(ID, 'PROCESADO'));
    const count = emitted.length;
    signals.next(status(ID, 'ERROR'));
    signals.next({ kind: 'lost' });

    expect(emitted.length).toBe(count);
  });

  it('propaga el error del stream (por ejemplo, sin sesión)', () => {
    signals.error(new Error('Sin sesión activa'));

    expect(errors.length).toBe(1);
  });
});
