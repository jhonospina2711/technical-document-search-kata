import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/app.setup';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { postgresConnection } from '../src/database/postgres-connection';
import { createDocument, DocumentFormat } from '../src/documents/domain/document';
import { DocumentEventPublisher } from '../src/documents/application/ports';
import { DocumentOrmEntity } from '../src/documents/infrastructure/document.orm-entity';
import { FilesystemFileStore } from '../src/documents/infrastructure/filesystem-file-store';
import { ProcessDocument } from '../src/worker/application/process-document.use-case';
import { FormatContentExtractor } from '../src/worker/infrastructure/format-content-extractor';
import { PdfContentExtractor } from '../src/worker/infrastructure/pdf-content-extractor';
import { TextContentExtractor } from '../src/worker/infrastructure/text-content-extractor';
import { TypeOrmDocumentProcessingRepository } from '../src/worker/infrastructure/typeorm-document-processing.repository';
import { buildPdf } from './support/pdf-fixture';

config({ path: ['.env', '../.env'] });

/**
 * Persistencia del contenido de extremo a extremo (KTL-12): `POST /documents` → `ProcessDocument`
 * (el mismo caso de uso del Worker, sin broker) → `GET /documents/:id`, sobre una base temporal.
 * Se omite si PostgreSQL no está disponible.
 */
describe('Persistencia del contenido (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_content_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let uploadDir: string;
  let token: string;
  let processDocument: ProcessDocument;
  let files: FilesystemFileStore;
  let ownerId: string;
  let available = false;

  const upload = async (content: Buffer | string, name = 'guia.txt'): Promise<string> => {
    const req = request(app.getHttpServer()).post('/documents').set('Authorization', `Bearer ${token}`);
    const fields = { title: 'Guía de despliegue', author: 'Ada', category: 'Operaciones', version: '1.0' };
    Object.entries(fields).forEach(([key, value]) => req.field(key, value));
    const response = await req.attach('file', Buffer.from(content), name).expect(202);
    return response.body.id as string;
  };
  const get = async (id: string) => (await request(app.getHttpServer()).get(`/documents/${id}`).set('Authorization', `Bearer ${token}`).expect(200)).body;
  /** Deja un documento `PROCESANDO` con un archivo que el API habría rechazado (el volumen es un límite de confianza). */
  const insertProcessing = async (content: Buffer): Promise<string> => {
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
    await files.save(saved.id, content);
    return saved.id;
  };
  const fileExists = (id: string) => access(join(uploadDir, id)).then(() => true, () => false);

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
    } catch {
      console.warn('PostgreSQL no disponible: se omite la prueba e2e de persistencia del contenido');
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

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-content-'));
    Object.assign(process.env, { POSTGRES_DB: testDb, UPLOAD_DIR: uploadDir });
    // Import diferido: `ConfigModule.forRoot` lee el entorno al cargar el módulo.
    const { AppModule } = await import('../src/app.module');
    // Aquí no se prueba el broker (ver document-worker.e2e-spec.ts): el caso de uso se invoca directo.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DocumentEventPublisher)
      .useValue({ publishUploaded: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const registered = (
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'ada@example.com', name: 'Ada', password: 'secret1' })
        .expect(201)
    ).body;
    token = registered.token;
    ownerId = registered.user.id;

    files = new FilesystemFileStore({ getOrThrow: () => uploadDir } as unknown as ConfigService);
    processDocument = new ProcessDocument(
      new TypeOrmDocumentProcessingRepository(db.getRepository(DocumentOrmEntity)),
      files,
      new FormatContentExtractor(new TextContentExtractor(), new PdfContentExtractor()),
      { notify: async () => undefined },
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
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

  run('antes de procesar: PROCESANDO, content null y el archivo existe (AC-01)', async () => {
    const id = await upload('Hola');

    expect(await get(id)).toMatchObject({ id, status: 'PROCESANDO', content: null });
    expect(await fileExists(id)).toBe(true);
  });

  run('tras procesar: PROCESADO con el contenido normalizado, recuperable por id (AC-02)', async () => {
    const id = await upload('﻿  Hola\r\nmundo\r\n\r\n  ');

    await processDocument.execute(id);

    expect(await get(id)).toMatchObject({ id, status: 'PROCESADO', content: 'Hola\nmundo' });
  });

  run('dos documentos: cada id devuelve solo su propio contenido (AC-03)', async () => {
    const first = await upload('contenido del primero', 'primero.txt');
    const second = await upload('contenido del segundo', 'segundo.txt');

    await processDocument.execute(first);
    await processDocument.execute(second);

    expect(await get(first)).toMatchObject({ status: 'PROCESADO', content: 'contenido del primero' });
    expect(await get(second)).toMatchObject({ status: 'PROCESADO', content: 'contenido del segundo' });
  });

  run('PDF: PROCESADO con el texto de sus páginas (AC-04)', async () => {
    const id = await upload(buildPdf(['Primera pagina', 'Segunda pagina']), 'manual.pdf');

    await processDocument.execute(id);

    expect(await get(id)).toMatchObject({
      status: 'PROCESADO',
      fileFormat: 'PDF',
      content: 'Primera pagina\n\nSegunda pagina',
    });
  });

  run('contenido no UTF-8: ERROR y content null (AC-05)', async () => {
    const id = await insertProcessing(Buffer.from([0xff, 0xfe, 0x41]));

    await processDocument.execute(id);

    expect(await get(id)).toMatchObject({ status: 'ERROR', content: null });
  });

  run('reprocesar un documento PROCESADO no cambia content ni updatedAt (AC-06)', async () => {
    const id = await upload('Hola');
    await processDocument.execute(id);
    const before = await get(id);

    await processDocument.execute(id);

    expect(await get(id)).toEqual(before);
  });

  run('el archivo existe antes y se elimina tras persistir, en PROCESADO y en ERROR (AC-07)', async () => {
    const ok = await upload('Hola');
    const failed = await insertProcessing(Buffer.from([0x68, 0x00, 0x69]));
    expect(await fileExists(ok)).toBe(true);
    expect(await fileExists(failed)).toBe(true);

    await processDocument.execute(ok);
    await processDocument.execute(failed);

    expect(await get(ok)).toMatchObject({ status: 'PROCESADO', content: 'Hola' });
    expect(await get(failed)).toMatchObject({ status: 'ERROR', content: null });
    expect(await fileExists(ok)).toBe(false);
    expect(await fileExists(failed)).toBe(false);
  });
});
