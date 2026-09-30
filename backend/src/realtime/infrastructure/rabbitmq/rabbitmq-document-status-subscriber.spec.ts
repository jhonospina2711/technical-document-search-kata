import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { EventEmitter } from 'node:events';
import { DocumentStatusEvents } from '../../application/ports';
import { DocumentStatusEvent, toStatusMessage } from '../../domain/document-status-event';
import { RabbitMqDocumentStatusSubscriber } from './rabbitmq-document-status-subscriber';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

type Handler = (message: object | null) => void;

class FakeChannel extends EventEmitter {
  handler?: Handler;
  assertExchange = jest.fn(async () => undefined);
  assertQueue = jest.fn(async () => ({ queue: 'amq.gen-1' }));
  bindQueue = jest.fn(async () => undefined);
  consume = jest.fn(async (_queue: string, handler: Handler) => {
    this.handler = handler;
    return { consumerTag: 'tag-1' };
  });
  cancel = jest.fn(async () => undefined);
}

class FakeConnection extends EventEmitter {
  readonly channel = new FakeChannel();
  createChannel = jest.fn(async () => this.channel);
  close = jest.fn(async () => undefined);
}

const URL = 'amqp://usuario:secreta@localhost:5672';
const connectMock = connect as unknown as jest.Mock;
const flush = () => jest.advanceTimersByTimeAsync(0);
const settings = { getOrThrow: () => URL } as unknown as ConfigService;
const event: DocumentStatusEvent = {
  documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ownerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PROCESADO',
};

describe('RabbitMqDocumentStatusSubscriber', () => {
  let connections: FakeConnection[];
  let events: jest.Mocked<DocumentStatusEvents>;
  let subscriber: RabbitMqDocumentStatusSubscriber;
  let warnLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  const channel = () => connections[connections.length - 1].channel;
  const deliver = (body: string) => channel().handler?.({ content: Buffer.from(body) });

  beforeEach(async () => {
    jest.useFakeTimers();
    connections = [];
    connectMock.mockReset().mockImplementation(async () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    events = { emit: jest.fn(), stream: jest.fn() };
    subscriber = new RabbitMqDocumentStatusSubscriber(settings, events);
    subscriber.onApplicationBootstrap();
    await flush();
  });

  afterEach(async () => {
    await subscriber.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('declara el exchange y una cola exclusiva, efímera y enlazada, y consume sin ack', () => {
    expect(connectMock).toHaveBeenCalledWith(URL);
    expect(channel().assertExchange).toHaveBeenCalledWith('documents.status', 'fanout', { durable: true });
    expect(channel().assertQueue).toHaveBeenCalledWith('', { exclusive: true, durable: false, autoDelete: true });
    expect(channel().bindQueue).toHaveBeenCalledWith('amq.gen-1', 'documents.status', '');
    expect(channel().consume).toHaveBeenCalledWith('amq.gen-1', expect.any(Function), { noAck: true });
  });

  it('entrega al difusor un evento válido', () => {
    deliver(toStatusMessage(event));

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(event);
  });

  it.each([
    ['no es JSON', 'no-json'],
    ['tiene un tipo desconocido', JSON.stringify({ ...event, type: 'OTRO' })],
    ['trae ids que no son uuid', JSON.stringify({ type: 'DOCUMENT_STATUS_CHANGED', ...event, ownerId: '1' })],
    ['trae un estado no notificable', JSON.stringify({ type: 'DOCUMENT_STATUS_CHANGED', ...event, status: 'PROCESANDO' })],
  ])('descarta con un warn un mensaje que %s, sin volcar el cuerpo, y sigue consumiendo (AC-10)', (_name, body) => {
    deliver(body);
    deliver(toStatusMessage(event));

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(warnLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnLog.mock.calls)).not.toContain(event.ownerId);
  });

  it('ignora un cancel del broker (mensaje nulo)', () => {
    channel().handler?.(null);

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('reconecta a los 5 s tras cerrarse la conexión y vuelve a consumir (AC-09)', async () => {
    connections[0].emit('close');
    await jest.advanceTimersByTimeAsync(4999);
    expect(connectMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);

    expect(connectMock).toHaveBeenCalledTimes(2);
    deliver(toStatusMessage(event));
    expect(events.emit).toHaveBeenCalledWith(event);
  });

  it('una caída del canal y de la conexión dispara una sola reconexión', async () => {
    connections[0].channel.emit('error', new Error('channel closed'));
    connections[0].emit('close');

    await jest.advanceTimersByTimeAsync(5000);

    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('si el broker no está disponible al arrancar reintenta cada 5 s sin filtrar credenciales', async () => {
    await subscriber.onModuleDestroy();
    connectMock.mockReset().mockRejectedValue(new Error(`connect ECONNREFUSED ${URL}`));
    subscriber = new RabbitMqDocumentStatusSubscriber(settings, events);

    subscriber.onApplicationBootstrap();
    await flush();
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);

    expect(connectMock).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secreta');
  });

  it('si falla al declarar la cola cierra la conexión y reintenta', async () => {
    connectMock.mockClear();
    const broken = new FakeConnection();
    broken.channel.assertQueue.mockRejectedValueOnce(new Error('PRECONDITION_FAILED'));
    connectMock.mockImplementationOnce(async () => broken);
    connections[0].emit('close');

    await jest.advanceTimersByTimeAsync(5000);
    expect(broken.close).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('al apagar cancela el consumo, cierra la conexión y no reconecta', async () => {
    await subscriber.onModuleDestroy();

    expect(connections[0].channel.cancel).toHaveBeenCalledWith('tag-1');
    expect(connections[0].close).toHaveBeenCalled();
    connections[0].emit('close');
    await jest.advanceTimersByTimeAsync(10000);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('si ya se apagó, un arranque tardío no se conecta', async () => {
    connectMock.mockClear();
    const late = new RabbitMqDocumentStatusSubscriber(settings, events);

    await late.onModuleDestroy();
    late.onApplicationBootstrap();
    await flush();

    expect(connectMock).not.toHaveBeenCalled();
  });
});
