import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { AuthService } from '../../auth/services/auth.service';
import { RealtimeSignal } from '../interfaces/realtime.interfaces';
import { backoffDelayMs, RealtimeService } from './realtime.service';

type Read = ReadableStreamReadResult<Uint8Array>;

/** Lector controlado a mano; sus promesas son de zone.js, así `fakeAsync` las resuelve con `flushMicrotasks`. */
class FakeStream {
  private readonly encoder = new TextEncoder();
  private waiting: { resolve: (result: Read) => void; reject: (error: unknown) => void } | null = null;
  private queue: Read[] = [];
  private failure: unknown = null;

  getReader() {
    return { read: () => this.read() };
  }

  push(text: string): void {
    this.deliver({ done: false, value: this.encoder.encode(text) });
  }

  end(): void {
    this.deliver({ done: true, value: undefined });
  }

  abort(): void {
    this.failure = new DOMException('Aborted', 'AbortError');
    this.waiting?.reject(this.failure);
    this.waiting = null;
  }

  private deliver(result: Read): void {
    if (this.waiting) {
      this.waiting.resolve(result);
      this.waiting = null;
    } else {
      this.queue.push(result);
    }
  }

  private read(): Promise<Read> {
    if (this.failure) return Promise.reject(this.failure);
    const next = this.queue.shift();
    if (next) return Promise.resolve(next);
    return new Promise<Read>((resolve, reject) => (this.waiting = { resolve, reject }));
  }
}

type Mode = 'ok' | 'network' | 'hang' | 'html' | 'no-body' | number;

describe('backoffDelayMs', () => {
  it('duplica la espera hasta el tope de 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(backoffDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('RealtimeService', () => {
  const auth = { token: jasmine.createSpy('token'), logout: jasmine.createSpy('logout') };
  let service: RealtimeService;
  let fetchSpy: jasmine.Spy;
  let modes: Mode[];
  let streams: FakeStream[];
  let signals: RealtimeSignal[];
  let errors: unknown[];
  let completed: boolean;

  const eventFrame = (payload: unknown, event = 'document-status') =>
    `event: ${event}\ndata: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
  const statusEvent = (documentId: string, status: string) => ({ type: 'DOCUMENT_STATUS_CHANGED', documentId, status });

  function connect() {
    return service.connect().subscribe({
      next: (signal) => signals.push(signal),
      error: (error) => errors.push(error),
      complete: () => (completed = true),
    });
  }

  beforeEach(() => {
    auth.token.and.returnValue('jwt-123');
    auth.logout.calls.reset();
    modes = [];
    streams = [];
    signals = [];
    errors = [];
    completed = false;

    fetchSpy = spyOn(window, 'fetch').and.callFake((_url, init) => {
      const mode = modes.shift() ?? 'ok';
      const signal = init?.signal as AbortSignal;
      if (mode === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      if (mode === 'hang') {
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        );
      }
      const stream = new FakeStream();
      streams.push(stream);
      signal.addEventListener('abort', () => stream.abort());
      const status = typeof mode === 'number' ? mode : 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'Content-Type': mode === 'html' ? 'text/html' : 'text/event-stream' }),
        body: mode === 'no-body' ? null : stream,
      } as unknown as Response);
    });

    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    service = TestBed.inject(RealtimeService);
  });

  it('abre la conexión con Bearer y Accept y emite open', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();

    const [url, init] = fetchSpy.calls.mostRecent().args;
    expect(url).toMatch(/\/realtime\/events$/);
    expect(init.headers).toEqual({ Authorization: 'Bearer jwt-123', Accept: 'text/event-stream' });
    expect(signals).toEqual([{ kind: 'open' }]);
    subscription.unsubscribe();
  }));

  it('emite los eventos document-status válidos (AC-01, AC-02)', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();

    streams[0].push(eventFrame(statusEvent('doc-1', 'PROCESADO')) + eventFrame(statusEvent('doc-2', 'ERROR')));
    flushMicrotasks();

    expect(signals.slice(1)).toEqual([
      { kind: 'status', event: statusEvent('doc-1', 'PROCESADO') as never },
      { kind: 'status', event: statusEvent('doc-2', 'ERROR') as never },
    ]);
    subscription.unsubscribe();
  }));

  it('descarta tramas inválidas sin romper el flujo (AC-03)', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();

    [
      eventFrame('no es json'),
      eventFrame('null'),
      eventFrame({ ...statusEvent('doc-1', 'PROCESADO'), type: 'OTRO' }),
      eventFrame(statusEvent('doc-1', 'PROCESANDO')),
      eventFrame({ type: 'DOCUMENT_STATUS_CHANGED', status: 'ERROR' }),
      eventFrame(statusEvent('', 'ERROR')),
      eventFrame(statusEvent('doc-1', 'ERROR'), 'otro-evento'),
      'data: {}\n\n',
      eventFrame({}, 'heartbeat'),
    ].forEach((frame) => streams[0].push(frame));
    flushMicrotasks();
    expect(signals).toEqual([{ kind: 'open' }]);

    streams[0].push(eventFrame(statusEvent('doc-3', 'PROCESADO')));
    flushMicrotasks();
    expect(signals.length).toBe(2);
    subscription.unsubscribe();
  }));

  it('reintenta con backoff 1, 2, 4, 8, 16, 30 y 30 s tras fallos de red (AC-05)', fakeAsync(() => {
    modes = Array(8).fill('network');
    const subscription = connect();
    flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    [1000, 2000, 4000, 8000, 16000, 30000, 30000].forEach((delay, index) => {
      tick(delay - 1);
      expect(fetchSpy).toHaveBeenCalledTimes(index + 1);
      tick(1);
      flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(index + 2);
    });

    expect(signals.every((signal) => signal.kind === 'lost')).toBeTrue();
    expect(signals.length).toBe(8);
    subscription.unsubscribe();
  }));

  it('reinicia la espera a 1 s tras una conexión exitosa (AC-05)', fakeAsync(() => {
    modes = ['network', 'network', 'ok'];
    const subscription = connect();
    flushMicrotasks();
    tick(1000);
    flushMicrotasks();
    tick(2000);
    flushMicrotasks();
    expect(signals.map((signal) => signal.kind)).toEqual(['lost', 'lost', 'open']);

    streams[0].end();
    flushMicrotasks();
    expect(signals.at(-1)).toEqual({ kind: 'lost' });
    const calls = fetchSpy.calls.count();
    tick(999);
    expect(fetchSpy.calls.count()).toBe(calls);
    tick(1);
    flushMicrotasks();
    expect(fetchSpy.calls.count()).toBe(calls + 1);
    subscription.unsubscribe();
  }));

  it('reintenta ante respuestas no 2xx, sin event-stream o sin body', fakeAsync(() => {
    modes = [503, 'html', 'no-body'];
    const subscription = connect();
    flushMicrotasks();
    tick(1000);
    flushMicrotasks();
    tick(2000);
    flushMicrotasks();

    expect(signals).toEqual([{ kind: 'lost' }, { kind: 'lost' }, { kind: 'lost' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    subscription.unsubscribe();
  }));

  it('trata el cierre del stream por el servidor como caída', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();
    streams[0].end();
    flushMicrotasks();

    expect(signals).toEqual([{ kind: 'open' }, { kind: 'lost' }]);
    subscription.unsubscribe();
  }));

  it('aborta y reconecta tras 60 s sin datos (FR-05)', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();
    tick(59_999);
    flushMicrotasks();
    expect(signals).toEqual([{ kind: 'open' }]);

    tick(1);
    flushMicrotasks();
    expect(signals).toEqual([{ kind: 'open' }, { kind: 'lost' }]);
    tick(1000);
    flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  }));

  it('un latido reinicia el vigilante de inactividad', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();
    tick(50_000);
    streams[0].push(eventFrame({}, 'heartbeat'));
    flushMicrotasks();
    tick(50_000);
    flushMicrotasks();
    expect(signals).toEqual([{ kind: 'open' }]);
    subscription.unsubscribe();
  }));

  it('el vigilante también cubre un fetch que no responde', fakeAsync(() => {
    modes = ['hang'];
    const subscription = connect();
    flushMicrotasks();
    tick(60_000);
    flushMicrotasks();

    expect(signals).toEqual([{ kind: 'lost' }]);
    subscription.unsubscribe();
  }));

  it('con 401 cierra la sesión, completa y no reintenta (AC-06)', fakeAsync(() => {
    modes = [401];
    connect();
    flushMicrotasks();
    tick(120_000);

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(completed).toBeTrue();
    expect(signals).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  }));

  it('sin token falla con error y no conecta', fakeAsync(() => {
    auth.token.and.returnValue(null);
    connect();
    flushMicrotasks();

    expect(errors.length).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  }));

  it('al desuscribirse aborta la conexión y no deja temporizadores (AC-07)', fakeAsync(() => {
    const subscription = connect();
    flushMicrotasks();
    const signal = fetchSpy.calls.mostRecent().args[1].signal as AbortSignal;

    subscription.unsubscribe();
    flushMicrotasks();

    expect(signal.aborted).toBeTrue();
    expect(signals).toEqual([{ kind: 'open' }]);
    // `fakeAsync` falla al terminar si queda algún temporizador (vigilante o reintento).
  }));

  it('al desuscribirse durante la espera de un reintento lo cancela (AC-07)', fakeAsync(() => {
    modes = ['network'];
    const subscription = connect();
    flushMicrotasks();
    subscription.unsubscribe();
    tick(30_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  }));
});
