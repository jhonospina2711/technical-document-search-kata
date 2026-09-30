import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { Subject } from 'rxjs';
import { AuthenticateToken } from '../../auth/application/authenticate-token.use-case';
import { InvalidTokenError } from '../../auth/domain/errors';
import { AuthGuard } from '../../auth/presentation/auth.guard';
import { requestIdMiddleware } from '../../common/request-id';
import { DocumentStatusEvents } from '../application/ports';
import { StreamDocumentStatus } from '../application/stream-document-status.use-case';
import { DocumentStatusEvent } from '../domain/document-status-event';
import { InMemoryDocumentStatusEvents } from '../infrastructure/in-memory-document-status-events';
import { HEARTBEAT_INTERVAL_MS, RealtimeController } from './realtime.controller';

const ada = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] };
const grace = { ...ada, id: '9b2f5c1e-3d4a-4f6b-8a1c-2e7d9f0a1b3c', email: 'grace@example.com', name: 'Grace' };
const tokens: Record<string, typeof ada> = { 'token-ada': ada, 'token-grace': grace };
const eventOf = (ownerId: string, status: DocumentStatusEvent['status'] = 'PROCESADO'): DocumentStatusEvent => ({
  documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ownerId,
  status,
});

/** Cliente SSE mínimo: abre `GET /realtime/events` y acumula lo que llega. */
interface Stream {
  response: IncomingMessage;
  received: () => string;
  waitFor: (text: string) => Promise<void>;
  close: () => void;
}

describe('RealtimeController (HTTP)', () => {
  let app: INestApplication;
  let events: InMemoryDocumentStatusEvents;
  let port: number;
  const open: Stream[] = [];

  const subscribers = () => (events as unknown as { subject: Subject<unknown> }).subject.observed;
  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(condition()).toBe(true);
  };

  const connect = (token?: string): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ port, path: '/realtime/events', headers: token ? { authorization: `Bearer ${token}` } : {} });
      req.on('error', reject);
      req.on('response', (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        const stream: Stream = {
          response,
          received: () => body,
          waitFor: (text) => until(() => body.includes(text)),
          close: () => req.destroy(),
        };
        open.push(stream);
        resolve(stream);
      });
      req.end();
    });

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const authenticate = {
      execute: async (token: string) => {
        if (!tokens[token]) throw new InvalidTokenError();
        return tokens[token];
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RealtimeController],
      providers: [
        { provide: DocumentStatusEvents, useClass: InMemoryDocumentStatusEvents },
        StreamDocumentStatus,
        AuthGuard,
        { provide: AuthenticateToken, useValue: authenticate },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    events = app.get(DocumentStatusEvents);
  });

  afterEach(async () => {
    open.splice(0).forEach((stream) => stream.close());
    await until(() => !subscribers());
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it.each([
    ['sin token', undefined],
    ['con un token inválido', 'otro'],
  ])('responde 401 %s y no abre el stream (AC-06)', async (_name, token) => {
    const stream = await connect(token);

    expect(stream.response.statusCode).toBe(401);
    expect(stream.response.headers['content-type']).not.toContain('text/event-stream');
    expect(subscribers()).toBe(false);
  });

  it('abre el stream con las cabeceras SSE para evitar caché y buffering de proxies', async () => {
    const stream = await connect('token-ada');

    expect(stream.response.statusCode).toBe(200);
    expect(stream.response.headers['content-type']).toContain('text/event-stream');
    expect(stream.response.headers['cache-control']).toContain('no-cache');
    expect(stream.response.headers.connection).toBe('keep-alive');
    expect(stream.response.headers['x-accel-buffering']).toBe('no');
  });

  it('entrega el evento del dueño con el formato SSE y sin ownerId (AC-01)', async () => {
    const stream = await connect('token-ada');
    await until(() => subscribers());

    events.emit(eventOf(ada.id));
    await stream.waitFor('event: document-status');

    // Nest añade un `id` secuencial por conexión; el servidor no lo usa (no hay reenvío con Last-Event-ID).
    expect(stream.received().replace(/^id: \d+\n/m, '')).toContain(
      'event: document-status\ndata: {"type":"DOCUMENT_STATUS_CHANGED","documentId":"0f8fad5b-d9cb-469f-a165-70867728950e","status":"PROCESADO"}\n\n',
    );
    expect(stream.received()).not.toContain('ownerId');
    expect(stream.received()).not.toContain(ada.id);
  });

  it('entrega el estado ERROR (AC-02)', async () => {
    const stream = await connect('token-ada');
    await until(() => subscribers());

    events.emit(eventOf(ada.id, 'ERROR'));

    await stream.waitFor('"status":"ERROR"');
  });

  it('aísla a los usuarios y entrega a todas las conexiones del dueño (AC-03)', async () => {
    const tabs = [await connect('token-ada'), await connect('token-ada')];
    const other = await connect('token-grace');
    await until(() => subscribers());

    events.emit(eventOf(ada.id));
    events.emit(eventOf(grace.id, 'ERROR'));
    await Promise.all(tabs.map((tab) => tab.waitFor('"status":"PROCESADO"')));
    await other.waitFor('"status":"ERROR"');

    tabs.forEach((tab) => expect(tab.received()).not.toContain('"status":"ERROR"'));
    expect(other.received()).not.toContain('"status":"PROCESADO"');
  });

  it('cancela la suscripción cuando el cliente cierra la conexión (AC-07)', async () => {
    const first = await connect('token-ada');
    await connect('token-ada');
    await until(() => subscribers());

    first.close();
    events.emit(eventOf(ada.id));

    await until(() => !first.response.readable || first.response.destroyed);
    expect(subscribers()).toBe(true);
    open.forEach((stream) => stream.close());
    await until(() => !subscribers());
  });
});

describe('RealtimeController (latido)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const controller = () => {
    const source = new Subject<DocumentStatusEvent>();
    const useCase = { execute: jest.fn().mockReturnValue(source.asObservable()) };
    return { source, useCase, controller: new RealtimeController(useCase as unknown as StreamDocumentStatus) };
  };
  const request = { user: ada, headers: {} } as never;

  it('envía un heartbeat cada 25 s sin eventos (AC-08)', () => {
    const { controller: instance } = controller();
    const received: unknown[] = [];
    const subscription = instance.events(request).subscribe((message) => received.push(message));

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(received).toEqual([]);
    jest.advanceTimersByTime(1);
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(received).toEqual([
      { type: 'heartbeat', data: {} },
      { type: 'heartbeat', data: {} },
    ]);
    subscription.unsubscribe();
  });

  it('pide el flujo del usuario autenticado y deja de emitir latidos al cancelar', () => {
    const { useCase, controller: instance } = controller();
    const received: unknown[] = [];
    const subscription = instance.events(request).subscribe((message) => received.push(message));

    expect(useCase.execute).toHaveBeenCalledWith(ada.id);
    subscription.unsubscribe();
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    expect(received).toEqual([]);
  });
});
