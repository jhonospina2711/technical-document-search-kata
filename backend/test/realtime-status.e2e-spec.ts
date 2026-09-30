import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { connect } from 'amqplib';
import type { ChannelModel } from 'amqplib';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/app.setup';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { postgresConnection } from '../src/database/postgres-connection';
import { DocumentEventPublisher } from '../src/documents/application/ports';
import { createDocument, DocumentFormat, DocumentStatus } from '../src/documents/domain/document';
import { DocumentOrmEntity } from '../src/documents/infrastructure/document.orm-entity';
import { FilesystemFileStore } from '../src/documents/infrastructure/filesystem-file-store';
import { ProcessDocument } from '../src/worker/application/process-document.use-case';
import { FormatContentExtractor } from '../src/worker/infrastructure/format-content-extractor';
import { PdfContentExtractor } from '../src/worker/infrastructure/pdf-content-extractor';
import { RabbitMqDocumentStatusNotifier } from '../src/worker/infrastructure/rabbitmq/rabbitmq-document-status-notifier';
import { TextContentExtractor } from '../src/worker/infrastructure/text-content-extractor';
import { TypeOrmDocumentProcessingRepository } from '../src/worker/infrastructure/typeorm-document-processing.repository';

config({ path: ['.env', '../.env'] });

/** Cliente SSE mínimo: abre `GET /realtime/events` y acumula lo que llega. */
interface Stream {
  received: () => string;
  close: () => void;
}

/**
 * Aviso de estado de extremo a extremo (SPEC-14): `ProcessDocument` con el notifier real → exchange
 * `documents.status` de RabbitMQ → suscriptor del API → `GET /realtime/events`, sobre una base
 * temporal. El broker de `documents.process` no interviene: el caso de uso se invoca directo, así que
 * no choca con un Worker en marcha. Se omite si PostgreSQL o RabbitMQ no están disponibles.
 */
describe('Aviso de estado por SSE (PostgreSQL y RabbitMQ reales)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_realtime_${process.pid}_${Date.now()}`;
  const rabbitUrl = process.env.RABBITMQ_URL;
  let admin: DataSource;
  let db: DataSource;
  let broker: ChannelModel;
  let app: INestApplication;
  let port: number;
  let uploadDir: string;
  let files: FilesystemFileStore;
  let notifier: RabbitMqDocumentStatusNotifier;
  let processDocument: ProcessDocument;
  let ada: { token: string; id: string };
  let grace: { token: string; id: string };
  let available = false;
  const streams: Stream[] = [];

  const until = async (condition: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('tiempo de espera agotado en la prueba');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const register = async (email: string, name: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/register').send({ email, name, password: 'secret1' }).expect(201);
    return { token: body.token as string, id: body.user.id as string };
  };
  const open = (token: string): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ port, path: '/realtime/events', headers: { authorization: `Bearer ${token}` } });
      req.on('error', reject);
      req.on('response', (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        const stream: Stream = { received: () => body, close: () => req.destroy() };
        streams.push(stream);
        resolve(stream);
      });
      req.end();
    });
  /** Sube por el API (el broker de procesamiento está reemplazado) y devuelve el id del documento. */
  const upload = async (user: { token: string }, content: string): Promise<string> => {
    const req = request(app.getHttpServer()).post('/documents').set('Authorization', `Bearer ${user.token}`);
    const fields = { title: 'Guía de despliegue', author: 'Ada', category: 'Operaciones', version: '1.0' };
    Object.entries(fields).forEach(([key, value]) => req.field(key, value));
    return (await req.attach('file', Buffer.from(content), 'guia.txt').expect(202)).body.id as string;
  };
  /** Deja un documento `PROCESANDO` con un archivo que el API habría rechazado. */
  const insertUnprocessable = async (ownerId: string): Promise<string> => {
    const repo = db.getRepository(DocumentOrmEntity);
    const saved = await repo.save(
      repo.create(
        createDocument({
          title: 'Guía',
          author: 'Ada',
          category: 'Operaciones',
          tags: [],
          version: '1.0',
          fileName: 'invalido.txt',
          fileFormat: DocumentFormat.TXT,
          ownerId,
        }),
      ),
    );
    await files.save(saved.id, Buffer.from('con un byte nulo \u0000 dentro'));
    return saved.id;
  };
  const occurrences = (text: string, part: string) => text.split(part).length - 1;

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      if (!rabbitUrl) throw new Error('RABBITMQ_URL sin definir');
      await admin.initialize();
      broker = await connect(rabbitUrl);
    } catch (error) {
      console.warn(`PostgreSQL o RabbitMQ no disponible: se omite la prueba e2e de avisos SSE (${(error as Error).message})`);
      if (admin.isInitialized) await admin.destroy();
      return;
    }
    available = true;
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await admin.query(`CREATE DATABASE "${testDb}"`);
    db = new DataSource({
      ...connection,
      database: testDb,
      entities: [UserOrmEntity, DocumentOrmEntity],
      migrations: [`${__dirname}/../src/database/migrations/*.ts`],
    });
    await db.initialize();
    await db.runMigrations();

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-realtime-'));
    Object.assign(process.env, { POSTGRES_DB: testDb, UPLOAD_DIR: uploadDir });
    // Import diferido: `ConfigModule.forRoot` lee el entorno al cargar el módulo.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DocumentEventPublisher)
      .useValue({ publishUploaded: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    ada = await register('ada@example.com', 'Ada');
    grace = await register('grace@example.com', 'Grace');

    const settings = { getOrThrow: (key: string) => (key === 'RABBITMQ_URL' ? rabbitUrl : uploadDir) } as unknown as ConfigService;
    files = new FilesystemFileStore(settings);
    notifier = new RabbitMqDocumentStatusNotifier(settings);
    processDocument = new ProcessDocument(
      new TypeOrmDocumentProcessingRepository(db.getRepository(DocumentOrmEntity)),
      files,
      new FormatContentExtractor(new TextContentExtractor(), new PdfContentExtractor()),
      notifier,
    );
  });

  afterEach(() => {
    streams.splice(0).forEach((stream) => stream.close());
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (!available) return;
    await notifier.onModuleDestroy();
    await app?.close();
    await broker.close();
    if (db?.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.destroy();
    await rm(uploadDir, { recursive: true, force: true });
  });

  /**
   * El suscriptor del API se conecta sin bloquear el arranque: se envían avisos de sondeo hasta que
   * llega uno, y solo entonces la prueba puede confiar en que su cola ya está enlazada.
   */
  const waitForSubscriber = async (stream: Stream): Promise<void> => {
    const probe = randomUUID();
    await until(async () => {
      await notifier.notify({ documentId: probe, ownerId: ada.id, status: DocumentStatus.ERROR });
      await pause(100);
      return stream.received().includes(probe);
    });
  };

  const run = (name: string, fn: () => Promise<void>, timeoutMs = 20000) =>
    it(
      name,
      async () => {
        if (!available) return;
        await fn();
      },
      timeoutMs,
    );

  run('el dueño recibe PROCESADO en todas sus conexiones y otro usuario no recibe nada (AC-01, AC-03)', async () => {
    const tabs = [await open(ada.token), await open(ada.token)];
    const other = await open(grace.token);
    await waitForSubscriber(tabs[0]);
    const adaDoc = await upload(ada, 'Contenido de Ada');
    const graceDoc = await upload(grace, 'Contenido de Grace');

    await processDocument.execute(adaDoc);
    await until(() => tabs.every((tab) => tab.received().includes(adaDoc)));
    await processDocument.execute(graceDoc);
    await until(() => other.received().includes(graceDoc));

    const expected = `event: document-status`;
    tabs.forEach((tab) => {
      expect(tab.received()).toContain(expected);
      expect(tab.received()).toContain(`"documentId":"${adaDoc}","status":"PROCESADO"`);
      expect(tab.received()).not.toContain(graceDoc);
    });
    expect(other.received()).toContain(`"documentId":"${graceDoc}","status":"PROCESADO"`);
    expect(other.received()).not.toContain(adaDoc);
    [...tabs, other].forEach((stream) => expect(stream.received()).not.toContain('ownerId'));
  });

  run('un documento no procesable llega como ERROR (AC-02)', async () => {
    const stream = await open(ada.token);
    await waitForSubscriber(stream);
    const id = await insertUnprocessable(ada.id);

    await processDocument.execute(id);
    await until(() => stream.received().includes(id));

    expect(stream.received()).toContain(`"documentId":"${id}","status":"ERROR"`);
  });

  run('una entrega repetida no vuelve a avisar (AC-04)', async () => {
    const stream = await open(ada.token);
    await waitForSubscriber(stream);
    const id = await upload(ada, 'Contenido');

    await processDocument.execute(id);
    await until(() => stream.received().includes(id));
    await processDocument.execute(id);
    await pause(500);

    expect(occurrences(stream.received(), id)).toBe(1);
    expect((await db.getRepository(DocumentOrmEntity).findOneByOrFail({ id })).status).toBe(DocumentStatus.PROCESADO);
  });

  run('sin token el stream responde 401', async () => {
    await request(app.getHttpServer()).get('/realtime/events').expect(401);
  });
});
