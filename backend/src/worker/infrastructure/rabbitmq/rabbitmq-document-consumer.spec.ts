import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { EventEmitter } from 'node:events';
import { ProcessDocument } from '../../application/process-document.use-case';
import { RabbitMqDocumentConsumer } from './rabbitmq-document-consumer';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

type Handler = (message: object | null) => void;

class FakeChannel extends EventEmitter {
  handler?: Handler;
  assertExchange = jest.fn(async () => undefined);
  assertQueue = jest.fn(async () => undefined);
  bindQueue = jest.fn(async () => undefined);
  prefetch = jest.fn(async () => undefined);
  consume = jest.fn(async (_queue: string, handler: Handler) => {
    this.handler = handler;
    return { consumerTag: 'tag-1' };
  });
  cancel = jest.fn(async () => undefined);
  ack = jest.fn();
  nack = jest.fn();
}

class FakeConnection extends EventEmitter {
  readonly channel = new FakeChannel();
  createChannel = jest.fn(async () => this.channel);
  close = jest.fn(async () => undefined);
}

const URL = 'amqp://usuario:secreta@localhost:5672';
const ID = '3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69';
const connectMock = connect as unknown as jest.Mock;
const messageOf = (body: string) => ({ content: Buffer.from(body) });
const flush = () => jest.advanceTimersByTimeAsync(0);

describe('RabbitMqDocumentConsumer', () => {
  let connections: FakeConnection[];
  let processDocument: { execute: jest.Mock };
  let consumer: RabbitMqDocumentConsumer;
  let errorLog: jest.SpyInstance;

  const channel = () => connections[connections.length - 1].channel;
  const deliver = async (body: string) => {
    const message = messageOf(body);
    channel().handler?.(message);
    await flush();
    return message;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    connections = [];
    connectMock.mockReset().mockImplementation(async () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    processDocument = { execute: jest.fn().mockResolvedValue(undefined) };
    consumer = new RabbitMqDocumentConsumer(
      { getOrThrow: () => URL } as unknown as ConfigService,
      processDocument as unknown as ProcessDocument,
    );
    consumer.onApplicationBootstrap();
    await flush();
  });

  afterEach(async () => {
    await consumer.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('declara la topología, fija prefetch(1) y consume con ack manual', () => {
    expect(connectMock).toHaveBeenCalledWith(URL);
    expect(channel().assertQueue).toHaveBeenCalledWith('documents.process', expect.objectContaining({ durable: true }));
    expect(channel().prefetch).toHaveBeenCalledWith(1);
    expect(channel().consume).toHaveBeenCalledWith('documents.process', expect.any(Function), { noAck: false });
  });

  it('hace ack tras procesar el documento (AC-01)', async () => {
    const message = await deliver(JSON.stringify({ documentId: ID }));

    expect(processDocument.execute).toHaveBeenCalledWith(ID);
    expect(channel().ack).toHaveBeenCalledWith(message);
    expect(channel().nack).not.toHaveBeenCalled();
  });

  it('reintenta con 2 s de espera y hace ack una sola vez si el fallo se resuelve (AC-08)', async () => {
    processDocument.execute.mockRejectedValueOnce(new Error('db caída')).mockResolvedValue(undefined);

    const message = await deliver(JSON.stringify({ documentId: ID }));
    expect(processDocument.execute).toHaveBeenCalledTimes(1);
    expect(channel().ack).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1999);
    expect(processDocument.execute).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(processDocument.execute).toHaveBeenCalledTimes(2);
    expect(channel().ack).toHaveBeenCalledTimes(1);
    expect(channel().ack).toHaveBeenCalledWith(message);
    expect(channel().nack).not.toHaveBeenCalled();
  });

  it('tras 3 intentos fallidos hace nack sin reencolar (DLQ) (AC-09)', async () => {
    processDocument.execute.mockRejectedValue(new Error('db caída'));

    const message = await deliver(JSON.stringify({ documentId: ID }));
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);

    expect(processDocument.execute).toHaveBeenCalledTimes(3);
    expect(channel().nack).toHaveBeenCalledWith(message, false, false);
    expect(channel().ack).not.toHaveBeenCalled();
  });

  it('el log de error no expone credenciales de la URL', async () => {
    processDocument.execute.mockRejectedValue(new Error('fallo con amqp://usuario:secreta@host'));

    await deliver(JSON.stringify({ documentId: ID }));
    await jest.advanceTimersByTimeAsync(4000);

    const logged = errorLog.mock.calls.map(([line]) => line).join('\n');
    expect(logged).toContain('DLQ');
    expect(logged).not.toContain('secreta');
  });

  it.each([
    ['no es JSON', 'esto no es json'],
    ['no es un objeto', '"texto"'],
    ['null', 'null'],
    ['no trae documentId', JSON.stringify({ otro: 1 })],
    ['documentId no es uuid', JSON.stringify({ documentId: '../../etc/passwd' })],
    ['documentId no es texto', JSON.stringify({ documentId: 42 })],
  ])('un mensaje que %s va a la DLQ sin invocar el caso de uso (AC-10)', async (_name, body) => {
    const message = await deliver(body);

    expect(processDocument.execute).not.toHaveBeenCalled();
    expect(channel().nack).toHaveBeenCalledWith(message, false, false);
  });

  it('si el canal ya se cerró al confirmar, no propaga el error', async () => {
    channel().ack.mockImplementation(() => {
      throw new Error('Channel closed');
    });

    await expect(deliver(JSON.stringify({ documentId: ID }))).resolves.toBeDefined();
  });

  it('reconecta a los 5 s tras cerrarse la conexión y vuelve a consumir (AC-12)', async () => {
    connections[0].emit('close');
    await flush();
    expect(connectMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5000);

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(connections[1].channel.consume).toHaveBeenCalled();
    const message = await deliver(JSON.stringify({ documentId: ID }));
    expect(connections[1].channel.ack).toHaveBeenCalledWith(message);
  });

  it('agenda una sola reconexión aunque falle la conexión y el canal a la vez', async () => {
    connections[0].emit('error', new Error('x'));
    connections[0].channel.emit('close');
    await jest.advanceTimersByTimeAsync(5000);

    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('si el broker no está disponible al arrancar, reintenta cada 5 s sin lanzar error', async () => {
    await consumer.onModuleDestroy();
    connectMock.mockReset().mockRejectedValueOnce(new Error('ECONNREFUSED amqp://u:clave@h')).mockImplementation(async () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    });
    consumer = new RabbitMqDocumentConsumer(
      { getOrThrow: () => URL } as unknown as ConfigService,
      processDocument as unknown as ProcessDocument,
    );

    consumer.onApplicationBootstrap();
    await flush();
    expect(errorLog.mock.calls.map(([line]) => line).join('\n')).not.toContain('clave');
    await jest.advanceTimersByTimeAsync(5000);

    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('cierra la conexión si falla la preparación del canal y reintenta', async () => {
    await consumer.onModuleDestroy();
    connectMock.mockReset().mockImplementationOnce(async () => {
      const connection = new FakeConnection();
      connection.channel.assertQueue.mockRejectedValue(new Error('PRECONDITION_FAILED'));
      connections.push(connection);
      return connection;
    });
    consumer = new RabbitMqDocumentConsumer(
      { getOrThrow: () => URL } as unknown as ConfigService,
      processDocument as unknown as ProcessDocument,
    );

    consumer.onApplicationBootstrap();
    await flush();

    expect(connections[connections.length - 1].close).toHaveBeenCalled();
  });

  it('al apagar espera al mensaje en curso, hace ack y cierra la conexión (AC-13)', async () => {
    let finish: () => void = () => undefined;
    processDocument.execute.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const message = messageOf(JSON.stringify({ documentId: ID }));
    channel().handler?.(message);
    await flush();

    let closed = false;
    const shutdown = consumer.onModuleDestroy().then(() => (closed = true));
    await flush();
    expect(channel().cancel).toHaveBeenCalledWith('tag-1');
    expect(closed).toBe(false);

    finish();
    await shutdown;

    expect(channel().ack).toHaveBeenCalledWith(message);
    expect(connections[0].close).toHaveBeenCalled();
  });

  it('al apagar no espera más de 30 s a un mensaje atascado', async () => {
    processDocument.execute.mockReturnValue(new Promise(() => undefined));
    channel().handler?.(messageOf(JSON.stringify({ documentId: ID })));
    await flush();

    const shutdown = consumer.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(30000);
    await shutdown;

    expect(connections[0].close).toHaveBeenCalled();
    expect(channel().ack).not.toHaveBeenCalled();
  });

  it('apagándose, un fallo transitorio no envía el mensaje a la DLQ ni reintenta', async () => {
    processDocument.execute.mockRejectedValue(new Error('conexión perdida'));
    const message = messageOf(JSON.stringify({ documentId: ID }));
    channel().handler?.(message);
    const shutdown = consumer.onModuleDestroy();
    await flush();
    await shutdown;

    expect(channel().nack).not.toHaveBeenCalled();
    expect(channel().ack).not.toHaveBeenCalled();
    expect(processDocument.execute).toHaveBeenCalledTimes(1);
  });

  it('no reconecta después de apagarse', async () => {
    await consumer.onModuleDestroy();
    connections[0].emit('close');
    await jest.advanceTimersByTimeAsync(10000);

    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
