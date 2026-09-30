import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { assertStatusExchange, DOCUMENTS_STATUS_EXCHANGE } from '../../../documents/infrastructure/rabbitmq/topology';
import { sanitizeError } from '../../../documents/infrastructure/rabbitmq/sanitize';
import { DocumentStatusEvent, toStatusMessage } from '../../../realtime/domain/document-status-event';
import { DocumentStatusNotifier } from '../../application/ports';

/** Tiempo máximo para conectar, publicar y recibir la confirmación del broker. */
const PUBLISH_TIMEOUT_MS = 5000;

interface Session {
  connection: ChannelModel;
  channel: ConfirmChannel;
}

/**
 * Publica el aviso de estado en el exchange `documents.status`. La conexión se abre en el primer
 * aviso y se reabre tras una caída o un fallo. Nunca lanza: solo registra el error saneado.
 */
@Injectable()
export class RabbitMqDocumentStatusNotifier extends DocumentStatusNotifier implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqDocumentStatusNotifier.name);
  private readonly url: string;
  private session?: Promise<Session>;

  constructor(config: ConfigService) {
    super();
    this.url = config.getOrThrow<string>('RABBITMQ_URL');
  }

  async notify(event: DocumentStatusEvent): Promise<void> {
    let session: Promise<Session> | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      session = this.session ?? this.open();
      this.session = session;
      await Promise.race([
        this.publish(session, event),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('tiempo de espera agotado')), PUBLISH_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // Tras un fallo no se sabe en qué estado quedó el canal: se descarta y se reabre en el próximo aviso.
      if (session) this.discard(session);
      this.logger.error(`fallo al notificar el estado de ${event.documentId}: ${sanitizeError(error)}`);
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

  private async publish(pending: Promise<Session>, event: DocumentStatusEvent): Promise<void> {
    const { channel } = await pending;
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        DOCUMENTS_STATUS_EXCHANGE,
        '',
        Buffer.from(toStatusMessage(event)),
        { persistent: false, contentType: 'application/json', messageId: event.documentId },
        (error) => (error ? reject(error) : resolve()),
      );
    });
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
        await assertStatusExchange(channel);
        return { connection, channel };
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
