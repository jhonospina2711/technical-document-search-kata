import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/app.setup';
import { postgresConnection } from '../src/database/postgres-connection';

config({ path: ['.env', '../.env'] });

/**
 * Levanta la aplicación completa sobre una base temporal (nunca la de desarrollo) y prueba
 * `POST /documents` de extremo a extremo. Se omite si PostgreSQL no está disponible.
 */
describe('POST /documents (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_upload_${process.pid}_${Date.now()}`;
  const maxFileSize = 1024;
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let uploadDir: string;
  let token: string;
  let userId: string;
  let available = false;

  const upload = (fields: Record<string, string> = {}, file?: { content: Buffer | string; name: string }, auth = true) => {
    const req = request(app.getHttpServer()).post('/documents');
    if (auth) req.set('Authorization', `Bearer ${token}`);
    const body = { title: 'Guía de despliegue', author: 'Ada', category: 'Operaciones', version: '1.0', ...fields };
    Object.entries(body).forEach(([key, value]) => req.field(key, value));
    if (file) req.attach('file', Buffer.from(file.content), file.name);
    return req;
  };
  const rowCount = async () => Number((await db.query('SELECT count(*) FROM documents'))[0].count);

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
    } catch {
      console.warn('PostgreSQL no disponible: se omite la prueba e2e de POST /documents');
      return;
    }
    available = true;
    await admin.query(`CREATE DATABASE "${testDb}"`);
    db = new DataSource({
      ...connection,
      database: testDb,
      migrations: [`${__dirname}/../src/database/migrations/*.ts`],
    });
    await db.initialize();
    await db.runMigrations();

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-upload-'));
    Object.assign(process.env, {
      POSTGRES_DB: testDb,
      UPLOAD_DIR: uploadDir,
      UPLOAD_MAX_FILE_SIZE_BYTES: String(maxFileSize),
    });
    // Import diferido: `ConfigModule.forRoot` lee el entorno al cargar el módulo.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'ada@example.com', name: 'Ada', password: 'secret1' })
      .expect(201);
    token = registered.body.token;
    userId = registered.body.user.id;
  });

  afterAll(async () => {
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

  run('carga válida: 202 con id y PROCESANDO, fila y archivo guardados (AC-01, AC-02, AC-07)', async () => {
    const response = await upload({ tags: ' api, rest ,,seguridad ' }, { content: '# Guía', name: '../../guia.md' }).expect(202);

    expect(response.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), status: 'PROCESANDO' });
    const [row] = await db.query('SELECT * FROM documents WHERE id = $1', [response.body.id]);
    expect(row).toMatchObject({
      title: 'Guía de despliegue',
      file_name: 'guia.md',
      file_format: 'MD',
      status: 'PROCESANDO',
      content: null,
      owner_id: userId,
      tags: ['api', 'rest', 'seguridad'],
    });
    expect((await readFile(join(uploadDir, response.body.id))).toString()).toBe('# Guía');
  });

  run('sin token o con token inválido: 401 y no crea filas (AC-04)', async () => {
    const before = await rowCount();
    await upload({}, { content: 'x', name: 'a.txt' }, false).expect(401);
    await request(app.getHttpServer()).post('/documents').set('Authorization', 'Bearer basura').expect(401);
    expect(await rowCount()).toBe(before);
  });

  run('rechaza archivo ausente, metadatos faltantes y campos no permitidos con 400 (AC-05, AC-08)', async () => {
    const before = await rowCount();
    await upload().expect(400);
    await upload({ title: '  ' }, { content: 'x', name: 'a.txt' }).expect(400);
    await upload({ ownerId: 'otro', status: 'PROCESADO' }, { content: 'x', name: 'a.txt' }).expect(400);
    expect(await rowCount()).toBe(before);
  });

  run('rechaza extensiones no soportadas y archivos vacíos con 400 (AC-06)', async () => {
    const before = await rowCount();
    await upload({}, { content: 'x', name: 'virus.exe' }).expect(400);
    await upload({}, { content: '', name: 'vacio.txt' }).expect(400);
    expect(await rowCount()).toBe(before);
  });

  run('rechaza archivos por encima del límite con 413', async () => {
    const before = await rowCount();
    await upload({}, { content: 'x'.repeat(maxFileSize + 1), name: 'grande.txt' }).expect(413);
    expect(await rowCount()).toBe(before);
  });
});
