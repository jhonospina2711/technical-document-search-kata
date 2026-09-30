import type { Channel } from 'amqplib';

// Contrato compartido con el Document Worker: RabbitMQ rechaza redeclarar una cola con
// argumentos distintos, así que API y Worker deben usar estas mismas constantes.
export const DOCUMENTS_QUEUE = 'documents.process';
export const DOCUMENTS_DLX = 'documents.dlx';
export const DOCUMENTS_DLQ = 'documents.process.dlq';

/** Declara (de forma idempotente) la cola de procesamiento y su dead-letter. */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(DOCUMENTS_DLX, 'direct', { durable: true });
  await channel.assertQueue(DOCUMENTS_DLQ, { durable: true });
  await channel.bindQueue(DOCUMENTS_DLQ, DOCUMENTS_DLX, DOCUMENTS_QUEUE);
  await channel.assertQueue(DOCUMENTS_QUEUE, {
    durable: true,
    deadLetterExchange: DOCUMENTS_DLX,
    deadLetterRoutingKey: DOCUMENTS_QUEUE,
  });
}

// Avisos de estado Worker → API: exchange fanout sin cola durable; cada instancia del API
// declara la suya (exclusiva y efímera) porque los eventos no tienen valor una vez obsoletos.
export const DOCUMENTS_STATUS_EXCHANGE = 'documents.status';

/** Declara (de forma idempotente) el exchange de avisos de estado. */
export async function assertStatusExchange(channel: Channel): Promise<void> {
  await channel.assertExchange(DOCUMENTS_STATUS_EXCHANGE, 'fanout', { durable: true });
}
