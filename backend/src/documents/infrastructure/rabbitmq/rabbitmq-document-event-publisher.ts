import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { DocumentEventPublisher } from '../../application/ports';
import { EventPublishError } from '../../domain/errors';
import { sanitizeError } from './sanitize';
import { assertTopology, DOCUMENTS_QUEUE } from './topology';

/** Tiempo máximo para conectar, publicar y recibir la confirmación del broker. */
const PUBLISH_TIMEOUT_MS = 5000;

interface Session {
  connection: ChannelModel;
  channel: ConfirmChannel;
  /** Mensajes que el broker devolvió por no ser enrutables (`mandatory`). */
  returned: Set<string>;
}

/**
 * Publica en `documents.process` con confirmación del broker. La conexión se abre en la primera
 * publicación y se vuelve a abrir tras una caída o un fallo, sin reiniciar el API.
 */
@Injectable()
export class RabbitMqDocumentEventPublisher extends DocumentEventPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqDocumentEventPublisher.name);
  private readonly url: string;
  private session?: Promise<Session>;

  constructor(config: ConfigService) {
    super();
    this.url = config.getOrThrow<string>('RABBITMQ_URL');
  }

  async publishUploaded(documentId: string): Promise<void> {
    const session = this.session ?? this.open();
    this.session = session;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.publish(session, documentId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('tiempo de espera agotado')), PUBLISH_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // Tras un fallo no se sabe en qué estado quedó el canal: se descarta y se reabre en la próxima.
      this.discard(session);
      this.logger.error(`fallo al publicar el evento de ${documentId}: ${sanitizeError(error)}`);
      throw new EventPublishError({ cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    const opened = await session?.catch(() => undefined);
    await opened?.connection.close().catch(() => undefined);
  }

  private async publish(pending: Promise<Session>, documentId: string): Promise<void> {
    const { channel, returned } = await pending;
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        '',
        DOCUMENTS_QUEUE,
        Buffer.from(JSON.stringify({ documentId })),
        {
          persistent: true,
          mandatory: true,
          contentType: 'application/json',
          messageId: documentId,
          type: 'document.uploaded',
          timestamp: Math.floor(Date.now() / 1000),
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    if (returned.delete(documentId)) {
      throw new Error('el broker no pudo enrutar el mensaje');
    }
  }

  private open(): Promise<Session> {
    const pending: Promise<Session> = (async () => {
      const connection = await connect(this.url);
      const drop = () => this.discard(pending);
      connection.on('error', drop);
      connection.on('close', drop);
      try {
        const channel = await connection.createConfirmChannel();
        channel.on('error', drop);
        channel.on('close', drop);
        const returned = new Set<string>();
        channel.on('return', (message) => returned.add(message.properties.messageId));
        await assertTopology(channel);
        return { connection, channel, returned };
      } catch (error) {
        await connection.close().catch(() => undefined);
        throw error;
      }
    })();
    return pending;
  }

  /** Olvida la sesión (si sigue siendo la vigente) y cierra su conexión sin esperar. */
  private discard(pending: Promise<Session>): void {
    if (this.session === pending) {
      this.session = undefined;
    }
    void pending.then((opened) => opened.connection.close()).catch(() => undefined);
  }
}
