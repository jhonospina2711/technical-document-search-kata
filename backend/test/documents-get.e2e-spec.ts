import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/app.setup';
import { DocumentEventPublisher } from '../src/documents/application/ports';
import { postgresConnection } from '../src/database/postgres-connection';

config({ path: ['.env', '../.env'] });

/**
 * Levanta la aplicación completa sobre una base temporal (nunca la de desarrollo) y prueba
 * `GET /documents/:id` de extremo a extremo. Se omite si PostgreSQL no está disponible.
 */
describe('GET /documents/:id (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_get_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let uploadDir: string;
  let tokenA: string;
  let tokenB: string;
  let ownerA: string;
  let available = false;

  const insert = async (status: string, content: string | null, tags: string[] = ['api', 'rest']) => {
    const [row] = await db.query(
      `INSERT INTO documents (title, author, category, tags, version, file_name, file_format, status, content, owner_id)
       VALUES ('Manual TK-400', 'Dra. Soto', 'Manuales O&M', $1, '1.2.0', 'tk400.md', 'MD', $2, $3, $4) RETURNING id`,
      [tags, status, content, ownerA],
    );
    return row.id as string;
  };
  const get = (id: string, token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).get(`/documents/${id}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const register = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, name: 'Usuario', password: 'secret1' })
      .expect(201);
    return { token: response.body.token as string, id: response.body.user.id as string };
  };

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
    } catch {
      console.warn('PostgreSQL no disponible: se omite la prueba e2e de GET /documents/:id');
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

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-get-'));
    Object.assign(process.env, { POSTGRES_DB: testDb, UPLOAD_DIR: uploadDir });
    // Import diferido: `ConfigModule.forRoot` lee el entorno al cargar el módulo.
    const { AppModule } = await import('../src/app.module');
    // Solo se lee: el doble evita tocar el broker real (ver documents-publish.e2e-spec.ts).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DocumentEventPublisher)
      .useValue({ publishUploaded: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const a = await register('ada@example.com');
    tokenA = a.token;
    ownerA = a.id;
    tokenB = (await register('grace@example.com')).token;
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

  run('documento PROCESADO: 200 con metadatos y contenido, sin ownerId (AC-01)', async () => {
    const id = await insert('PROCESADO', '# Manual\n\nTexto');

    const response = await get(id).expect(200);

    expect(response.body).toEqual({
      id,
      title: 'Manual TK-400',
      author: 'Dra. Soto',
      category: 'Manuales O&M',
      tags: ['api', 'rest'],
      version: '1.2.0',
      fileName: 'tk400.md',
      fileFormat: 'MD',
      status: 'PROCESADO',
      content: '# Manual\n\nTexto',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
  });

  run('documento PROCESANDO o ERROR: 200 con content null (AC-02)', async () => {
    const processing = await insert('PROCESANDO', null);
    const failed = await insert('ERROR', null);

    expect((await get(processing).expect(200)).body).toMatchObject({ status: 'PROCESANDO', content: null });
    expect((await get(failed).expect(200)).body).toMatchObject({ status: 'ERROR', content: null });
  });

  run('UUID inexistente: 404 con el mensaje estándar (AC-03)', async () => {
    const response = await get('3f2b8c1e-7a4d-4e6b-9c1f-2d5a8b7c6e10').expect(404);

    expect(response.body).toEqual({ statusCode: 404, message: 'Documento no encontrado', error: 'Not Found' });
  });

  run('id que no es UUID: 400 sin llegar a la base de datos (AC-04)', async () => {
    for (const id of ['abc', '123']) {
      const response = await get(id).expect(400);
      expect(response.body.message).toBe('Identificador de documento inválido');
    }
  });

  run('sin token o con token inválido: 401 incluso con id inválido (AC-05)', async () => {
    const id = await insert('PROCESADO', 'x');

    await get(id, null).expect(401);
    await get('abc', null).expect(401);
    await get(id, 'basura').expect(401);
  });

  run('otro usuario autenticado puede leer el documento (AC-06)', async () => {
    const id = await insert('PROCESADO', 'x');

    await get(id, tokenB).expect(200);
  });

  run('documento sin tags devuelve una lista vacía (AC-07)', async () => {
    const id = await insert('PROCESADO', 'x', []);

    expect((await get(id).expect(200)).body.tags).toEqual([]);
  });
});
