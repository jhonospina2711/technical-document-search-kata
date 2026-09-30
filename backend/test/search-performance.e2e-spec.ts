import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/app.setup';
import { postgresConnection } from '../src/database/postgres-connection';
import { DocumentEventPublisher } from '../src/documents/application/ports';

config({ path: ['.env', '../.env'] });

const INDEX = 'idx_documents_search_vector';
const SYNTHETIC_DOCS = 5000;
const RARE_EVERY = 500; // → 10 documentos con la palabra rara
const RARE_WORD = 'zxqrarisimo';
const FREQUENT_WORD = 'servidores'; // en todos los documentos: peor caso de ranking
const RUNS = 10;

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

/**
 * Medición de referencia de `GET /search` (AC-16): volumen sintético, `VACUUM ANALYZE`, plan de la
 * condición de coincidencia y `tookMs` de la respuesta. **No** valida el objetivo de 400–1000 ms:
 * solo deja registradas las cifras (la prueba no falla por tiempo). Se omite sin PostgreSQL.
 */
describe('GET /search — medición de referencia (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_searchperf_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let uploadDir: string;
  let token: string;
  let available = false;

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
    } catch {
      console.warn('PostgreSQL no disponible: se omite la medición de GET /search');
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

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-searchperf-'));
    Object.assign(process.env, { POSTGRES_DB: testDb, UPLOAD_DIR: uploadDir });
    const { AppModule } = await import('../src/app.module');
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

    // Tokens md5 casi únicos por documento (~700 caracteres), una palabra en todos y otra en unos pocos.
    await db.query(
      `INSERT INTO documents (title, author, category, tags, version, file_name, file_format, content, status, owner_id)
       SELECT 'Documento ' || g, 'Autor ' || (g % 50), 'Categoria ' || (g % 10), ARRAY['tag' || (g % 20)],
              '1.0', 'f.txt', 'TXT',
              'Informe ' || g || ' sobre ${FREQUENT_WORD}, configuracion y despliegue. '
                || (SELECT string_agg(md5((g * k)::text), ' ') FROM generate_series(1, 20) k)
                || CASE WHEN g % ${RARE_EVERY} = 0 THEN ' ${RARE_WORD}' ELSE '' END,
              'PROCESADO', $1
       FROM generate_series(1, ${SYNTHETIC_DOCS}) g`,
      [registered.body.user.id],
    );
    // VACUUM vuelca la pending list del GIN (fastupdate); con ella llena el planificador penaliza el índice.
    await db.query(`VACUUM ANALYZE documents`);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (available) await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    if (admin?.isInitialized) await admin.destroy();
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  const run = (name: string, fn: () => Promise<void>) =>
    it(
      name,
      async () => {
        if (!available) return;
        await fn();
      },
      120_000,
    );

  const percentile = (sorted: number[], p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

  async function measure(label: string, q: string, expectedTotal: number): Promise<void> {
    const took: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const startedAt = performance.now();
      const { body } = await request(app.getHttpServer())
        .get('/search')
        .query({ q })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      wall.push(Math.round(performance.now() - startedAt));
      took.push(body.tookMs);
      expect(body.total).toBe(expectedTotal);
      expect(body.items.length).toBe(Math.min(10, expectedTotal));
    }
    const sortedTook = [...took].sort((a, b) => a - b);
    const sortedWall = [...wall].sort((a, b) => a - b);
    console.log(
      `[medición] ${SYNTHETIC_DOCS} documentos, ${label} (${expectedTotal} coincidencias, ${RUNS} ejecuciones): ` +
        `tookMs min ${sortedTook[0]} / p50 ${percentile(sortedTook, 50)} / p95 ${percentile(sortedTook, 95)} / max ${sortedTook.at(-1)}; ` +
        `HTTP p50 ${percentile(sortedWall, 50)} ms / p95 ${percentile(sortedWall, 95)} ms`,
    );
  }

  run('la condición de coincidencia de un término poco frecuente usa el índice GIN (AC-16)', async () => {
    const [row] = await db.query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT id FROM documents
        WHERE status = 'PROCESADO' AND search_vector @@ websearch_to_tsquery('documents_es', $1)`,
      [RARE_WORD],
    );
    const [{ Plan, 'Execution Time': ms }] = row['QUERY PLAN'];
    const nodes = flatten(Plan);
    console.log(`[medición] plan del término raro: ${ms} ms; nodos: ${nodes.map((n) => n['Node Type']).join(' > ')}`);

    expect(nodes.some((n) => n['Node Type'] === 'Bitmap Index Scan' && n['Index Name'] === INDEX)).toBe(true);
    expect(nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'documents')).toBe(false);
  });

  run('registra tookMs de un término raro, uno presente en todos los documentos y una frase (AC-16)', async () => {
    await measure('término raro', RARE_WORD, SYNTHETIC_DOCS / RARE_EVERY);
    await measure(`término en todos los documentos («${FREQUENT_WORD}»)`, FREQUENT_WORD, SYNTHETIC_DOCS);
    await measure('frase «configuracion y despliegue»', '"configuracion y despliegue"', SYNTHETIC_DOCS);
  });
});
