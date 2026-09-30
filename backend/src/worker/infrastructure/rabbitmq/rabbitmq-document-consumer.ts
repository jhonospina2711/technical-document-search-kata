import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { sanitizeError } from '../../../documents/infrastructure/rabbitmq/sanitize';
import { assertTopology, DOCUMENTS_QUEUE } from '../../../documents/infrastructure/rabbitmq/topology';
import { ProcessDocument } from '../../application/process-document.use-case';

const PREFETCH = 1;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const RECONNECT_DELAY_MS = 5000;
const SHUTDOWN_TIMEOUT_MS = 30000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Session {
  connection: ChannelModel;
  channel: Channel;
  consumerTag: string;
}

/**
 * Consume `documents.process` con ack manual: ack solo tras dejar el resultado en PostgreSQL;
 * mensajes malformados o con errores transitorios que agotan los intentos van a la DLQ.
 * Reconecta por su cuenta si el broker se cae.
 */
@Injectable()
export class RabbitMqDocumentConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqDocumentConsumer.name);
  private readonly url: string;
  private connection?: ChannelModel;
  private session?: Session;
  private inFlight?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly processDocument: ProcessDocument,
  ) {
    this.url = config.getOrThrow<string>('RABBITMQ_URL');
  }

  onApplicationBootstrap(): void {
    // Sin await: el Worker arranca aunque el broker aún no esté disponible y reintenta la conexión.
    void this.start();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    const { session, inFlight } = this;
    this.session = undefined;
    this.inFlight = undefined;
    await session?.channel.cancel(session.consumerTag).catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      inFlight,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    await (session?.connection ?? this.connection)?.close().catch(() => undefined);
  }

  private async start(): Promise<void> {
    if (this.stopping) return;
    let connection: ChannelModel | undefined;
    try {
      connection = await connect(this.url);
      this.connection = connection;
      const dropped = () => this.onDropped(connection as ChannelModel);
      connection.on('error', dropped);
      connection.on('close', dropped);
      const channel = await connection.createChannel();
      channel.on('error', dropped);
      channel.on('close', dropped);
      await assertTopology(channel);
      await channel.prefetch(PREFETCH);
      const { consumerTag } = await channel.consume(
        DOCUMENTS_QUEUE,
        (message) => {
          if (message) this.inFlight = this.handle(channel, message);
        },
        { noAck: false },
      );
      this.session = { connection, channel, consumerTag };
      this.logger.log(`consumiendo ${DOCUMENTS_QUEUE}`);
    } catch (error) {
      this.logger.error(`no se pudo consumir ${DOCUMENTS_QUEUE}: ${sanitizeError(error)}`);
      this.onDropped(connection);
    }
  }

  /** La conexión o el canal se cayeron: se descartan y se reintenta tras una espera fija. */
  private onDropped(connection: ChannelModel | undefined): void {
    if (connection && connection !== this.connection) return;
    this.connection = undefined;
    this.session = undefined;
    void connection?.close().catch(() => undefined);
    if (this.stopping || this.reconnectTimer) return;
    this.logger.warn(`conexión con RabbitMQ no disponible; reintento en ${RECONNECT_DELAY_MS / 1000} s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.start();
    }, RECONNECT_DELAY_MS);
  }

  private async handle(channel: Channel, message: ConsumeMessage): Promise<void> {
    const documentId = parseDocumentId(message);
    if (!documentId) {
      this.logger.error('mensaje malformado descartado hacia la DLQ');
      return this.settle(() => channel.nack(message, false, false));
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await this.processDocument.execute(documentId);
        return this.settle(() => channel.ack(message));
      } catch (error) {
        const reason = sanitizeError(error);
        // Apagándose: sin ack ni nack el broker reentrega el mensaje (no debe ir a la DLQ por esto).
        if (this.stopping) return;
        if (attempt >= MAX_ATTEMPTS) {
          this.logger.error(`documento ${documentId} enviado a la DLQ tras ${attempt} intentos: ${reason}`);
          return this.settle(() => channel.nack(message, false, false));
        }
        this.logger.warn(`documento ${documentId}: intento ${attempt}/${MAX_ATTEMPTS} fallido: ${reason}`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  /** Si el canal ya se cerró, el broker reentregará el mensaje: no hay nada más que hacer. */
  private settle(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.warn(`no se pudo confirmar el mensaje: ${sanitizeError(error)}`);
    }
  }
}

function parseDocumentId(message: ConsumeMessage): string | null {
  try {
    const body: unknown = JSON.parse(message.content.toString('utf8'));
    const id = (body as { documentId?: unknown } | null)?.documentId;
    return typeof id === 'string' && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}
