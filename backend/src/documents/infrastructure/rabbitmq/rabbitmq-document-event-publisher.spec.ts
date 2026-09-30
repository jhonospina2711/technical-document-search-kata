import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { EventEmitter } from 'node:events';
import { EventPublishError } from '../../domain/errors';
import { RabbitMqDocumentEventPublisher } from './rabbitmq-document-event-publisher';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

type PublishCallback = (error: Error | null) => void;

class FakeChannel extends EventEmitter {
  assertExchange = jest.fn(async () => undefined);
  assertQueue = jest.fn(async () => undefined);
  bindQueue = jest.fn(async () => undefined);
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

describe('RabbitMqDocumentEventPublisher', () => {
  let connections: FakeConnection[];
  let publisher: RabbitMqDocumentEventPublisher;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    connections = [];
    connectMock.mockReset().mockImplementation(async () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    });
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    publisher = new RabbitMqDocumentEventPublisher({ getOrThrow: () => URL } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('no se conecta hasta la primera publicación', () => {
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('publica un mensaje persistente con solo el documentId', async () => {
    await publisher.publishUploaded('doc-1');

    expect(connectMock).toHaveBeenCalledWith(URL);
    const [exchange, key, content, options] = connections[0].channel.publish.mock.calls[0];
    expect(exchange).toBe('');
    expect(key).toBe('documents.process');
    expect(JSON.parse(content.toString())).toEqual({ documentId: 'doc-1' });
    expect(options).toMatchObject({
      persistent: true,
      mandatory: true,
      contentType: 'application/json',
      messageId: 'doc-1',
      type: 'document.uploaded',
    });
  });

  it('declara la topología y reutiliza la conexión entre publicaciones', async () => {
    await publisher.publishUploaded('doc-1');
    await publisher.publishUploaded('doc-2');

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connections[0].channel.assertQueue).toHaveBeenCalledTimes(2);
    expect(connections[0].channel.publish).toHaveBeenCalledTimes(2);
  });

  it('un nack del broker es un EventPublishError y la siguiente publicación reconecta', async () => {
    const first = new FakeConnection();
    first.channel.publish.mockImplementation((...args) => (args[4] as PublishCallback)(new Error('message nacked')));
    connectMock.mockImplementationOnce(async () => first);

    await expect(publisher.publishUploaded('doc-1')).rejects.toBeInstanceOf(EventPublishError);
    expect(first.close).toHaveBeenCalled();

    await expect(publisher.publishUploaded('doc-2')).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('un mensaje devuelto por el broker (no enrutable) es un fallo', async () => {
    const connection = new FakeConnection();
    connection.channel.publish.mockImplementation((...args) => {
      connection.channel.emit('return', { properties: { messageId: 'doc-1' } });
      (args[4] as PublishCallback)(null);
    });
    connectMock.mockImplementationOnce(async () => connection);

    await expect(publisher.publishUploaded('doc-1')).rejects.toBeInstanceOf(EventPublishError);
  });

  it('falla por tiempo si el broker no confirma en 5 s', async () => {
    jest.useFakeTimers();
    const connection = new FakeConnection();
    connection.channel.publish.mockImplementation(() => undefined);
    connectMock.mockImplementationOnce(async () => connection);

    const result = expect(publisher.publishUploaded('doc-1')).rejects.toBeInstanceOf(EventPublishError);
    await jest.advanceTimersByTimeAsync(4999);
    expect(errorLog).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await result;
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('tiempo de espera agotado'));
  });

  it('con el broker caído falla con EventPublishError, sin filtrar credenciales, y se recupera después', async () => {
    connectMock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${URL}`));

    const error = await publisher.publishUploaded('doc-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EventPublishError);
    expect((error as Error).message).not.toContain('secreta');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secreta');

    await expect(publisher.publishUploaded('doc-2')).resolves.toBeUndefined();
  });

  it('reabre la conexión si el broker la cierra entre publicaciones', async () => {
    await publisher.publishUploaded('doc-1');
    connections[0].emit('close');

    await publisher.publishUploaded('doc-2');

    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('si falla al declarar la topología cierra la conexión y falla', async () => {
    const connection = new FakeConnection();
    connection.channel.assertQueue.mockRejectedValueOnce(new Error('PRECONDITION_FAILED'));
    connectMock.mockImplementationOnce(async () => connection);

    await expect(publisher.publishUploaded('doc-1')).rejects.toBeInstanceOf(EventPublishError);
    expect(connection.close).toHaveBeenCalled();
  });

  it('cierra la conexión al terminar la aplicación', async () => {
    await publisher.publishUploaded('doc-1');

    await publisher.onModuleDestroy();

    expect(connections[0].close).toHaveBeenCalled();
  });

  it('al terminar sin haber publicado no hace nada', async () => {
    await expect(publisher.onModuleDestroy()).resolves.toBeUndefined();
    expect(connectMock).not.toHaveBeenCalled();
  });
});
