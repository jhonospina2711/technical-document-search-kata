import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { connect } from 'amqplib';
import type { Channel, ChannelModel, GetMessage } from 'amqplib';
import { config } from 'dotenv';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/app.setup';
import { DocumentEventPublisher } from '../src/documents/application/ports';
import { RabbitMqDocumentEventPublisher } from '../src/documents/infrastructure/rabbitmq/rabbitmq-document-event-publisher';
import { assertTopology, DOCUMENTS_DLQ, DOCUMENTS_QUEUE } from '../src/documents/infrastructure/rabbitmq/topology';
import { postgresConnection } from '../src/database/postgres-connection';

config({ path: ['.env', '../.env'] });

const UNREACHABLE_BROKER = 'amqp://usuario:secreta@127.0.0.1:1';

/**
 * Publicación del evento de procesamiento (SPEC-05) sobre PostgreSQL y RabbitMQ reales. Usa una base
 * temporal y las colas reales `documents.process` y su DLQ, sin purgarlas: cada caso localiza su
 * mensaje por `documentId` y lo consume, y los mensajes ajenos se devuelven a la cola. Se omite si
 * PostgreSQL o RabbitMQ no están disponibles.
 */
describe('POST /documents publica el evento (PostgreSQL y RabbitMQ reales)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_publish_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let appWithoutBroker: INestApplication;
  let broker: ChannelModel;
  let channel: Channel;
  let uploadDir: string;
  let token: string;
  let available = false;

  const upload = (target: INestApplication = app) =>
    request(target.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Guía de despliegue')
      .field('author', 'Ada')
      .field('category', 'Operaciones')
      .field('version', '1.0')
      .attach('file', Buffer.from('# Guía'), 'guia.md');
  const filesOnDisk = async () => (await readdir(uploadDir)).length;
  const rowCount = async () => Number((await db.query('SELECT count(*) FROM documents'))[0].count);

  /** Toma de la cola el mensaje del documento (sin ack) y devuelve los ajenos a la cola. */
  const take = async (queue: string, documentId: string): Promise<GetMessage | undefined> => {
    const others: GetMessage[] = [];
    let found: GetMessage | undefined;
    for (let message = await channel.get(queue); message; message = await channel.get(queue)) {
      if (message.properties.messageId === documentId) {
        found = message;
        break;
      }
      others.push(message);
    }
    others.forEach((message) => channel.nack(message, false, true));
    return found;
  };
  const takeEventually = async (queue: string, documentId: string): Promise<GetMessage | undefined> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const message = await take(queue, documentId);
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
  };

  const createApp = async (publisher?: DocumentEventPublisher) => {
    // Import diferido: `ConfigModule.forRoot` lee el entorno al cargar el módulo.
    const { AppModule } = await import('../src/app.module');
    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (publisher) builder = builder.overrideProvider(DocumentEventPublisher).useValue(publisher);
    const moduleRef = await builder.compile();
    const nestApp = moduleRef.createNestApplication();
    configureApp(nestApp);
    await nestApp.init();
    return nestApp;
  };

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
      broker = await connect(process.env.RABBITMQ_URL as string);
    } catch {
      console.warn('PostgreSQL o RabbitMQ no disponibles: se omite la prueba e2e de publicación');
      return;
    }
    available = true;
    channel = await broker.createChannel();
    await assertTopology(channel);

    await admin.query(`CREATE DATABASE "${testDb}"`);
    db = new DataSource({
      ...connection,
      database: testDb,
      migrations: [`${__dirname}/../src/database/migrations/*.ts`],
    });
    await db.initialize();
    await db.runMigrations();

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-publish-'));
    Object.assign(process.env, { POSTGRES_DB: testDb, UPLOAD_DIR: uploadDir });
    app = await createApp();
    // Mismo API, pero con un publicador real apuntando a un broker inexistente.
    appWithoutBroker = await createApp(
      new RabbitMqDocumentEventPublisher({ getOrThrow: () => UNREACHABLE_BROKER } as unknown as ConfigService),
    );

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'ada@example.com', name: 'Ada', password: 'secret1' })
      .expect(201);
    token = registered.body.token;
  });

  afterAll(async () => {
    await appWithoutBroker?.close();
    await app?.close();
    await broker?.close().catch(() => undefined);
    if (db?.isInitialized) await db.destroy();
    if (available) await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    if (admin?.isInitialized) await admin.destroy();
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  const run = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!available) return;
      await fn();
    });

  run('202 y un único mensaje persistente en la cola con solo el documentId (AC-01, AC-02)', async () => {
    const response = await upload().expect(202);
    const { id } = response.body;

    const message = await takeEventually(DOCUMENTS_QUEUE, id);

    expect(message).toBeDefined();
    expect(JSON.parse(message!.content.toString())).toEqual({ documentId: id });
    expect(message!.properties).toMatchObject({
      deliveryMode: 2,
      messageId: id,
      type: 'document.uploaded',
      contentType: 'application/json',
    });
    channel.ack(message!);
    expect(await take(DOCUMENTS_QUEUE, id)).toBeUndefined();
  });

  run('sin broker: 503 sin detalles internos, sin fila ni fichero (AC-03)', async () => {
    const rowsBefore = await rowCount();
    const filesBefore = await filesOnDisk();

    const response = await upload(appWithoutBroker).expect(503);

    expect(response.body).toEqual({
      statusCode: 503,
      message: 'Servicio no disponible, intenta de nuevo',
      error: 'Service Unavailable',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secreta|127\.0\.0\.1|ECONNREFUSED/);
    expect(await rowCount()).toBe(rowsBefore);
    expect(await filesOnDisk()).toBe(filesBefore);
  });

  run('un mensaje rechazado con nack(requeue=false) termina en la DLQ (AC-06)', async () => {
    const { id } = (await upload().expect(202)).body;
    const message = await takeEventually(DOCUMENTS_QUEUE, id);
    expect(message).toBeDefined();

    channel.nack(message!, false, false);

    const dead = await takeEventually(DOCUMENTS_DLQ, id);
    expect(dead).toBeDefined();
    expect(JSON.parse(dead!.content.toString())).toEqual({ documentId: id });
    channel.ack(dead!);
    expect(await take(DOCUMENTS_QUEUE, id)).toBeUndefined();
  });

  run('tras cortarse la conexión con el broker, la siguiente carga vuelve a publicar (AC-08)', async () => {
    const publisher = app.get(DocumentEventPublisher) as unknown as {
      session: Promise<{ connection: ChannelModel }>;
    };
    await (await publisher.session).connection.close();

    const { id } = (await upload().expect(202)).body;

    const message = await takeEventually(DOCUMENTS_QUEUE, id);
    expect(message).toBeDefined();
    channel.ack(message!);
  });
});
