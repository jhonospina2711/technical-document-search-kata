import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { EventEmitter } from 'node:events';
import { DocumentStatusEvent } from '../../../realtime/domain/document-status-event';
import { RabbitMqDocumentStatusNotifier } from './rabbitmq-document-status-notifier';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

type PublishCallback = (error: Error | null) => void;

class FakeChannel extends EventEmitter {
  assertExchange = jest.fn(async () => undefined);
  publish = jest.fn((_exchange: string, _key: string, _content: Buffer, _options: object, done: PublishCallback) =>
    done(null),
  );
}

class FakeConnection extends EventEmitter {
  readonly channel = new FakeChannel();
  createConfirmChannel = jest.fn(async () => this.channel);
  close = jest.fn(async () => undefined);
}

const URL = 'amqp://usuario:secreta@localhost:5672';
const connectMock = connect as unknown as jest.Mock;
const event: DocumentStatusEvent = {
  documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ownerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PROCESADO',
};

describe('RabbitMqDocumentStatusNotifier', () => {
  let connections: FakeConnection[];
  let notifier: RabbitMqDocumentStatusNotifier;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    connections = [];
    connectMock.mockReset().mockImplementation(async () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    });
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    notifier = new RabbitMqDocumentStatusNotifier({ getOrThrow: () => URL } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('no se conecta hasta el primer aviso', () => {
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('declara el exchange y publica el evento no persistente sin routing key', async () => {
    await notifier.notify(event);

    expect(connectMock).toHaveBeenCalledWith(URL);
    expect(connections[0].channel.assertExchange).toHaveBeenCalledWith('documents.status', 'fanout', { durable: true });
    const [exchange, key, content, options] = connections[0].channel.publish.mock.calls[0];
    expect(exchange).toBe('documents.status');
    expect(key).toBe('');
    expect(JSON.parse(content.toString())).toEqual({ type: 'DOCUMENT_STATUS_CHANGED', ...event });
    expect(options).toMatchObject({ persistent: false, contentType: 'application/json', messageId: event.documentId });
  });

  it('reutiliza la conexión entre avisos', async () => {
    await notifier.notify(event);
    await notifier.notify({ ...event, status: 'ERROR' });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connections[0].channel.publish).toHaveBeenCalledTimes(2);
  });

  it('un nack del broker no lanza, se registra y el siguiente aviso reconecta', async () => {
    const first = new FakeConnection();
    first.channel.publish.mockImplementation((...args) => (args[4] as PublishCallback)(new Error('message nacked')));
    connectMock.mockImplementationOnce(async () => first);

    await expect(notifier.notify(event)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('message nacked'));
    expect(first.close).toHaveBeenCalled();

    await expect(notifier.notify(event)).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(connections[0].channel.publish).toHaveBeenCalledTimes(1);
  });

  it('no lanza si el broker no confirma en 5 s', async () => {
    jest.useFakeTimers();
    const connection = new FakeConnection();
    connection.channel.publish.mockImplementation(() => undefined);
    connectMock.mockImplementationOnce(async () => connection);

    const result = notifier.notify(event);
    await jest.advanceTimersByTimeAsync(4999);
    expect(errorLog).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('tiempo de espera agotado'));
    expect(connection.close).toHaveBeenCalled();
  });

  it('con el broker caído no lanza, no filtra credenciales y se recupera después', async () => {
    connectMock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${URL}`));

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secreta');
    await notifier.notify(event);
    expect(connections[0].channel.publish).toHaveBeenCalledTimes(1);
  });

  it('reabre la conexión si el broker la cierra entre avisos', async () => {
    await notifier.notify(event);
    connections[0].emit('close');

    await notifier.notify(event);

    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('si falla al declarar el exchange cierra la conexión y no lanza', async () => {
    const connection = new FakeConnection();
    connection.channel.assertExchange.mockRejectedValueOnce(new Error('PRECONDITION_FAILED'));
    connectMock.mockImplementationOnce(async () => connection);

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(connection.close).toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('PRECONDITION_FAILED'));
  });

  it('cierra la conexión al terminar la aplicación', async () => {
    await notifier.notify(event);

    await notifier.onModuleDestroy();

    expect(connections[0].close).toHaveBeenCalled();
  });

  it('al terminar sin haber avisado no hace nada', async () => {
    await expect(notifier.onModuleDestroy()).resolves.toBeUndefined();
    expect(connectMock).not.toHaveBeenCalled();
  });
});
