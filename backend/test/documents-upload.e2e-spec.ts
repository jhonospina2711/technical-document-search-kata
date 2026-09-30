import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
  const filesOnDisk = async () => (await readdir(uploadDir)).length;
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
    // Aquí se prueba la carga y su validación, no el broker (ver documents-publish.e2e-spec.ts):
    // sin este doble cada carga válida dejaría un mensaje huérfano en la cola real.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DocumentEventPublisher)
      .useValue({ publishUploaded: async () => undefined })
      .compile();
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

  /** Verifica el rechazo y que no quedó ni fila en `documents` ni fichero en `UPLOAD_DIR` (AC-11). */
  const expectRejected = async (req: request.Test, status: number, message: string) => {
    const rowsBefore = await rowCount();
    const filesBefore = await filesOnDisk();
    const response = await req.expect(status);
    expect(String(response.body.message)).toContain(message);
    expect(await rowCount()).toBe(rowsBefore);
    expect(await filesOnDisk()).toBe(filesBefore);
  };

  run('acepta PDF con firma y un archivo de exactamente el tamaño máximo (AC-01, AC-04)', async () => {
    await upload({}, { content: '%PDF-1.7\n%%EOF', name: 'manual.PDF' }).expect(202);
    await upload({}, { content: 'x'.repeat(maxFileSize), name: 'limite.txt' }).expect(202);
  });

  run('conserva los acentos y la ñ del nombre original del archivo', async () => {
    const response = await upload({}, { content: '# Guía', name: 'guía-diseño-ñandú.md' }).expect(202);

    const [row] = await db.query('SELECT file_name FROM documents WHERE id = $1', [response.body.id]);
    expect(row.file_name).toBe('guía-diseño-ñandú.md');
  });

  run('rechaza extensiones no soportadas con 400 (AC-02)', async () => {
    const message = 'Solo se admiten archivos .txt, .pdf y .md';
    await expectRejected(upload({}, { content: 'x', name: 'virus.exe' }), 400, message);
    await expectRejected(upload({}, { content: 'x', name: 'informe.docx' }), 400, message);
    await expectRejected(upload({}, { content: 'x', name: 'sin-extension' }), 400, message);
  });

  run('rechaza archivos por encima del límite con 413 y el límite en el mensaje (AC-03)', async () => {
    await expectRejected(
      upload({}, { content: 'x'.repeat(maxFileSize + 1), name: 'grande.txt' }),
      413,
      'El archivo supera el tamaño máximo permitido (1 KB)',
    );
  });

  run('rechaza contenido que no corresponde al formato con 400 (AC-06)', async () => {
    const message = 'El contenido del archivo no corresponde al formato';
    await expectRejected(upload({}, { content: 'solo texto', name: 'falso.pdf' }), 400, `${message} PDF`);
    await expectRejected(upload({}, { content: Buffer.from([0x68, 0x00, 0x69]), name: 'binario.txt' }), 400, `${message} TXT`);
    await expectRejected(upload({}, { content: Buffer.from([0xff, 0xfe, 0x41]), name: 'invalido.md' }), 400, `${message} MD`);
  });

  run('rechaza archivos vacíos con 400 (AC-07)', async () => {
    await expectRejected(upload({}, { content: '', name: 'vacio.txt' }), 400, 'El archivo está vacío');
  });

  run('rechaza nombres de más de 255 caracteres con 400 (AC-08)', async () => {
    await expectRejected(upload({}, { content: 'x', name: `${'a'.repeat(253)}.md` }), 400, 'Nombre de archivo inválido');
  });

  run('rechaza más de un archivo o un campo de archivo distinto de "file" con 400 (AC-09)', async () => {
    const message = 'Solo se admite un archivo en el campo "file"';
    const twoFiles = upload({}, { content: 'x', name: 'a.txt' }).attach('file', Buffer.from('y'), 'b.txt');
    await expectRejected(twoFiles, 400, message);
    const otherField = upload().attach('documento', Buffer.from('x'), 'a.txt');
    await expectRejected(otherField, 400, message);
  });

  run('rechaza más de 10 campos de texto con 400 (límite de multer, no del DTO)', async () => {
    const validForm = upload({}, { content: 'x', name: 'a.txt' });
    const extras = Array.from({ length: 7 }, (_, i) => `extra${i}`); // 4 base + 7 = 11 campos
    extras.forEach((name) => validForm.field(name, 'x'));
    await expectRejected(validForm, 400, 'Too many fields');
  });

  run('rechaza un campo de texto de 8 KB o más con 400', async () => {
    await expectRejected(upload({ title: 'a'.repeat(8 * 1024) }, { content: 'x', name: 'a.txt' }), 400, 'Field value too long');
    await upload({ title: 'a'.repeat(8 * 1024 - 1) }, { content: 'x', name: 'a.txt' }).expect(202);
  });

  run('un archivo inválido sin token recibe 401 y no se evalúa (AC-10)', async () => {
    await expectRejected(upload({}, { content: 'x'.repeat(maxFileSize + 1), name: 'virus.exe' }, false), 401, 'Unauthorized');
  });
});
