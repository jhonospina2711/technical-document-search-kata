import type { Channel } from 'amqplib';
import { assertTopology, DOCUMENTS_DLQ, DOCUMENTS_DLX, DOCUMENTS_QUEUE } from './topology';

describe('assertTopology', () => {
  it('declara el dead-letter y la cola principal apuntando a él', async () => {
    const calls: string[] = [];
    const channel = {
      assertExchange: jest.fn(async (...args: unknown[]) => calls.push(`exchange:${args[0]}`)),
      assertQueue: jest.fn(async (...args: unknown[]) => calls.push(`queue:${args[0]}`)),
      bindQueue: jest.fn(async (...args: unknown[]) => calls.push(`bind:${args[0]}`)),
    };

    await assertTopology(channel as unknown as Channel);

    expect(channel.assertExchange).toHaveBeenCalledWith('documents.dlx', 'direct', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith('documents.process.dlq', { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith('documents.process.dlq', 'documents.dlx', 'documents.process');
    expect(channel.assertQueue).toHaveBeenCalledWith('documents.process', {
      durable: true,
      deadLetterExchange: 'documents.dlx',
      deadLetterRoutingKey: 'documents.process',
    });
    // La cola principal se declara al final: su dead-letter ya debe existir.
    expect(calls).toEqual([
      'exchange:documents.dlx',
      'queue:documents.process.dlq',
      'bind:documents.process.dlq',
      'queue:documents.process',
    ]);
  });

  it('expone los nombres del contrato con el Worker', () => {
    expect([DOCUMENTS_QUEUE, DOCUMENTS_DLX, DOCUMENTS_DLQ]).toEqual([
      'documents.process',
      'documents.dlx',
      'documents.process.dlq',
    ]);
  });
});
