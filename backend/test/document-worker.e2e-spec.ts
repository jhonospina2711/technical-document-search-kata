import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { postgresConnection } from '../src/database/postgres-connection';
import { createDocument, DocumentFormat, DocumentStatus } from '../src/documents/domain/document';
import { DocumentOrmEntity } from '../src/documents/infrastructure/document.orm-entity';
import { FilesystemFileStore } from '../src/documents/infrastructure/filesystem-file-store';
import { RabbitMqDocumentEventPublisher } from '../src/documents/infrastructure/rabbitmq/rabbitmq-document-event-publisher';
import {
  assertTopology,
  DOCUMENTS_DLQ,
  DOCUMENTS_QUEUE,
} from '../src/documents/infrastructure/rabbitmq/topology';
import { ProcessDocument } from '../src/worker/application/process-document.use-case';
import { RabbitMqDocumentConsumer } from '../src/worker/infrastructure/rabbitmq/rabbitmq-document-consumer';
import { TextContentExtractor } from '../src/worker/infrastructure/text-content-extractor';
import { TypeOrmDocumentProcessingRepository } from '../src/worker/infrastructure/typeorm-document-processing.repository';

config({ path: ['.env', '../.env'] });

const metadata = {
  title: 'Guía',
  author: 'Ada',
  category: 'Operaciones',
  tags: [],
  version: '1.0',
  fileName: 'guia.txt',
  fileFormat: DocumentFormat.TXT,
};

/**
 * Document Worker contra PostgreSQL (base temporal migrada) y RabbitMQ reales. Usa las colas reales
 * `documents.process` y `documents.process.dlq`: las purga, así que se omite si otro Worker las
 * está consumiendo (deténlo antes de ejecutar esta prueba). Se omite también sin PostgreSQL o RabbitMQ.
 */
describe('Document Worker (PostgreSQL y RabbitMQ reales)', () => {
  const testDb = `docsearch_test_worker_${process.pid}_${Date.now()}`;
  const rabbitUrl = process.env.RABBITMQ_URL;
  let admin: DataSource;
  let db: DataSource;
  let broker: ChannelModel;
  let channel: ConfirmChannel;
  let uploadDir: string;
  let ownerId: string;
  let available = false;
  let files: FilesystemFileStore;
  let publisher: RabbitMqDocumentEventPublisher;
  let consumer: RabbitMqDocumentConsumer | undefined;

  const settings = (): ConfigService =>
    ({ getOrThrow: (key: string) => (key === 'RABBITMQ_URL' ? rabbitUrl : uploadDir) }) as unknown as ConfigService;

  const until = async (condition: () => Promise<boolean>, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('tiempo de espera agotado en la prueba');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const count = async (queue: string) => (await channel.checkQueue(queue)).messageCount;
  const exists = (path: string) => access(path).then(() => true, () => false);
  const document = (id: string) => db.getRepository(DocumentOrmEntity).findOneByOrFail({ id });

  /** Inserta un documento `PROCESANDO` con su archivo, como lo deja el API. */
  const upload = async (content: Buffer, format: DocumentFormat = DocumentFormat.TXT): Promise<string> => {
    const repo = db.getRepository(DocumentOrmEntity);
    const saved = await repo.save(repo.create(createDocument({ ...metadata, fileFormat: format, ownerId })));
    await files.save(saved.id, content);
    return saved.id;
  };

  const startConsumer = async (store: FilesystemFileStore = files): Promise<void> => {
    const useCase = new ProcessDocument(
      new TypeOrmDocumentProcessingRepository(db.getRepository(DocumentOrmEntity)),
      store,
      new TextContentExtractor(),
    );
    consumer = new RabbitMqDocumentConsumer(settings(), useCase);
    consumer.onApplicationBootstrap();
    await until(async () => (await channel.checkQueue(DOCUMENTS_QUEUE)).consumerCount === 1);
  };

  /** Detiene el Worker: si quedó algún mensaje sin ack, RabbitMQ lo devuelve a la cola. */
  const stopConsumer = async (): Promise<void> => {
    await consumer?.onModuleDestroy();
    consumer = undefined;
  };

  beforeAll(async () => {
    admin = new DataSource({ ...postgresConnection(process.env), database: 'postgres' });
    try {
      if (!rabbitUrl) throw new Error('RABBITMQ_URL sin definir');
      await admin.initialize();
      broker = await connect(rabbitUrl);
      channel = await broker.createConfirmChannel();
      await assertTopology(channel);
      if ((await channel.checkQueue(DOCUMENTS_QUEUE)).consumerCount > 0) {
        throw new Error(`${DOCUMENTS_QUEUE} ya tiene un consumidor (¿Worker en marcha?)`);
      }
    } catch (error) {
      console.warn(`PostgreSQL o RabbitMQ no disponible: se omite la prueba del Worker (${(error as Error).message})`);
      await broker?.close().catch(() => undefined);
      if (admin.isInitialized) await admin.destroy();
      return;
    }
    available = true;
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await admin.query(`CREATE DATABASE "${testDb}"`);
    db = new DataSource({
      ...postgresConnection(process.env),
      database: testDb,
      entities: [UserOrmEntity, DocumentOrmEntity],
      migrations: [`${__dirname}/../src/database/migrations/*.ts`],
    });
    await db.initialize();
    await db.runMigrations();
    ownerId = (await db.getRepository(UserOrmEntity).save({ email: 'ada@example.com', name: 'Ada', password: 'hash' })).id;
    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-worker-'));
    files = new FilesystemFileStore(settings());
    publisher = new RabbitMqDocumentEventPublisher(settings());
  });

  beforeEach(async () => {
    if (!available) return;
    await channel.purgeQueue(DOCUMENTS_QUEUE);
    await channel.purgeQueue(DOCUMENTS_DLQ);
  });

  afterEach(async () => {
    await stopConsumer();
  });

  afterAll(async () => {
    if (!available) return;
    await publisher.onModuleDestroy();
    await channel.purgeQueue(DOCUMENTS_QUEUE);
    await channel.purgeQueue(DOCUMENTS_DLQ);
    await broker.close();
    await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}"`);
    await admin.destroy();
    await rm(uploadDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const run = (name: string, fn: () => Promise<void>, timeoutMs = 20000) =>
    it(
      name,
      async () => {
        if (!available) return;
        await fn();
      },
      timeoutMs,
    );

  run('publicador real → Worker: PROCESADO con contenido normalizado, archivo eliminado y mensaje confirmado (AC-01, AC-16)', async () => {
    const id = await upload(Buffer.from('﻿  Hola\r\nmundo \r\n'));
    await startConsumer();

    await publisher.publishUploaded(id);
    await until(async () => (await document(id)).status !== DocumentStatus.PROCESANDO);

    const processed = await document(id);
    expect(processed).toMatchObject({ status: DocumentStatus.PROCESADO, content: 'Hola\nmundo' });
    expect(processed.updatedAt.getTime()).toBeGreaterThan(processed.createdAt.getTime());
    await until(async () => !(await exists(join(uploadDir, id))));
    // Detener el Worker devolvería a la cola cualquier mensaje sin ack: debe quedar vacía.
    await until(async () => (await count(DOCUMENTS_QUEUE)) === 0);
    await stopConsumer();
    expect(await count(DOCUMENTS_QUEUE)).toBe(0);
    expect(await count(DOCUMENTS_DLQ)).toBe(0);
  });

  run('un PDF termina en ERROR sin contenido, con el archivo eliminado y el mensaje confirmado (AC-03)', async () => {
    const id = await upload(Buffer.from('%PDF-1.7'), DocumentFormat.PDF);
    await startConsumer();

    await publisher.publishUploaded(id);
    await until(async () => (await document(id)).status !== DocumentStatus.PROCESANDO);

    expect(await document(id)).toMatchObject({ status: DocumentStatus.ERROR, content: null });
    await until(async () => !(await exists(join(uploadDir, id))));
    await stopConsumer();
    expect(await count(DOCUMENTS_QUEUE)).toBe(0);
    expect(await count(DOCUMENTS_DLQ)).toBe(0);
  });

  run('un documento inexistente se confirma sin escribir nada (AC-05)', async () => {
    await startConsumer();

    await publisher.publishUploaded(randomUUID());
    await until(async () => (await count(DOCUMENTS_QUEUE)) === 0);
    await stopConsumer();

    expect(await count(DOCUMENTS_QUEUE)).toBe(0);
    expect(await count(DOCUMENTS_DLQ)).toBe(0);
  });

  run('una entrega repetida no cambia un documento ya final y limpia el archivo residual (AC-06)', async () => {
    const id = await upload(Buffer.from('nuevo'));
    await db.getRepository(DocumentOrmEntity).update({ id }, { status: DocumentStatus.PROCESADO, content: 'previo' });
    const before = await document(id);
    await startConsumer();

    await publisher.publishUploaded(id);
    await until(async () => !(await exists(join(uploadDir, id))));
    await stopConsumer();

    expect(await document(id)).toMatchObject({ status: DocumentStatus.PROCESADO, content: 'previo', updatedAt: before.updatedAt });
    expect(await count(DOCUMENTS_QUEUE)).toBe(0);
  });

  run('un mensaje malformado va a la DLQ sin consultar documentos (AC-10)', async () => {
    await startConsumer();

    channel.sendToQueue(DOCUMENTS_QUEUE, Buffer.from('esto no es json'), { persistent: true });
    await until(async () => (await count(DOCUMENTS_DLQ)) === 1);

    expect(await count(DOCUMENTS_QUEUE)).toBe(0);
  });

  run(
    'un fallo transitorio persistente agota 3 intentos y deja el mensaje en la DLQ, sin tocar documento ni archivo (AC-09)',
    async () => {
      const id = await upload(Buffer.from('contenido'));
      const failing = Object.assign(Object.create(files) as FilesystemFileStore, {
        read: jest.fn().mockRejectedValue(new Error('disco no disponible')),
      });
      await startConsumer(failing);

      await publisher.publishUploaded(id);
      await until(async () => (await count(DOCUMENTS_DLQ)) === 1, 15000);

      expect(failing.read).toHaveBeenCalledTimes(3);
      expect(await document(id)).toMatchObject({ status: DocumentStatus.PROCESANDO, content: null });
      expect(await exists(join(uploadDir, id))).toBe(true);
      expect(await count(DOCUMENTS_QUEUE)).toBe(0);
    },
    30000,
  );
});
