import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { sanitizeError } from '../../../documents/infrastructure/rabbitmq/sanitize';
import { assertStatusExchange, DOCUMENTS_STATUS_EXCHANGE } from '../../../documents/infrastructure/rabbitmq/topology';
import { DocumentStatusEvents } from '../../application/ports';
import { DocumentStatusEvent, parseStatusEvent } from '../../domain/document-status-event';

const RECONNECT_DELAY_MS = 5000;

interface Session {
  connection: ChannelModel;
  channel: Channel;
  consumerTag: string;
}

/**
 * Consume `documents.status` con una cola exclusiva y efímera de esta instancia del API y entrega
 * los eventos válidos al difusor. Los eventos no se confirman ni se conservan: los ocurridos
 * mientras no hay conexión se pierden, y el frontend reconcilia con `GET /documents/:id`.
 */
@Injectable()
export class RabbitMqDocumentStatusSubscriber implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqDocumentStatusSubscriber.name);
  private readonly url: string;
  private connection?: ChannelModel;
  private session?: Session;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly events: DocumentStatusEvents,
  ) {
    this.url = config.getOrThrow<string>('RABBITMQ_URL');
  }

  onApplicationBootstrap(): void {
    // Sin await: el API arranca aunque el broker aún no esté disponible y reintenta la conexión.
    void this.start();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    const { session } = this;
    this.session = undefined;
    await session?.channel.cancel(session.consumerTag).catch(() => undefined);
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
      await assertStatusExchange(channel);
      const { queue } = await channel.assertQueue('', { exclusive: true, durable: false, autoDelete: true });
      await channel.bindQueue(queue, DOCUMENTS_STATUS_EXCHANGE, '');
      const { consumerTag } = await channel.consume(
        queue,
        (message) => {
          if (message) this.handle(message);
        },
        { noAck: true },
      );
      this.session = { connection, channel, consumerTag };
      this.logger.log(`escuchando ${DOCUMENTS_STATUS_EXCHANGE}`);
    } catch (error) {
      this.logger.error(`no se pudo escuchar ${DOCUMENTS_STATUS_EXCHANGE}: ${sanitizeError(error)}`);
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

  private handle(message: ConsumeMessage): void {
    const event = parseMessage(message);
    if (!event) {
      // Sin volcar el cuerpo: puede venir de cualquiera que publique en el exchange.
      this.logger.warn('evento de estado malformado descartado');
      return;
    }
    this.events.emit(event);
  }
}

function parseMessage(message: ConsumeMessage): DocumentStatusEvent | null {
  try {
    return parseStatusEvent(JSON.parse(message.content.toString('utf8')));
  } catch {
    return null;
  }
}
