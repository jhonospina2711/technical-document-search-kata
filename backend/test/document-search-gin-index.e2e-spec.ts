import { config } from 'dotenv';
import { DataSource, QueryRunner } from 'typeorm';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { postgresConnection } from '../src/database/postgres-connection';
import { DocumentOrmEntity } from '../src/documents/infrastructure/document.orm-entity';

config({ path: ['.env', '../.env'] });

const INDEX = 'idx_documents_search_vector';
const SYNTHETIC_DOCS = 5000;
const RARE_EVERY = 500; // → 10 documentos con la palabra rara
const RARE_WORD = 'zxqrarisimo';
const FREQUENT_WORD = 'servidores';

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

const SEARCH_SQL = `SELECT id FROM documents WHERE search_vector @@ websearch_to_tsquery('documents_es', $1)`;

/**
 * Índice GIN de `search_vector` (KTL-15) contra PostgreSQL real en una base temporal migrada: existencia,
 * uso en el plan con volumen sintético, equivalencia de resultados y mantenimiento por el UPDATE del
 * Worker. Se omite si PostgreSQL no está disponible.
 */
describe('índice GIN de search_vector (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_gin_test_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let available = false;
  let ownerId: string;

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
    } catch {
      console.warn('PostgreSQL no disponible: se omite la prueba del índice GIN');
      return;
    }
    available = true;
    await admin.query(`CREATE DATABASE "${testDb}"`);
    db = new DataSource({
      ...connection,
      database: testDb,
      entities: [UserOrmEntity, DocumentOrmEntity],
      migrations: [`${__dirname}/../src/database/migrations/*.ts`],
    });
    await db.initialize();
    await db.runMigrations();
    const user = await db.getRepository(UserOrmEntity).save({ email: 'ada@example.com', name: 'Ada', password: 'hash' });
    ownerId = user.id;

    // Volumen sintético: tokens md5 casi únicos por documento, una palabra en todos y otra en unos pocos.
    await db.query(
      `INSERT INTO documents (title, author, category, tags, version, file_name, file_format, content, status, owner_id)
       SELECT 'Documento ' || g, 'Autor ' || (g % 50), 'Categoria ' || (g % 10), ARRAY['tag' || (g % 20)],
              '1.0', 'f.txt', 'TXT',
              'Informe ' || g || ' sobre ${FREQUENT_WORD}, configuracion y despliegue. ' || md5(g::text) || ' ' || md5((g * 7)::text)
                || CASE WHEN g % ${RARE_EVERY} = 0 THEN ' ${RARE_WORD}' ELSE '' END,
              'PROCESADO', $1
       FROM generate_series(1, ${SYNTHETIC_DOCS}) g`,
      [ownerId],
    );
    // VACUUM vuelca la pending list del GIN (fastupdate); con ella llena el planificador penaliza el índice.
    await db.query(`VACUUM ANALYZE documents`);
  }, 120_000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (available) await admin.query(`DROP DATABASE IF EXISTS "${testDb}"`);
    if (admin?.isInitialized) await admin.destroy();
  });

  const run = (name: string, fn: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async () => {
        if (!available) return;
        await fn();
      },
      timeout,
    );

  /** Ejecuta `fn` en una sesión dedicada (los `SET` son por sesión), la restablece y la libera siempre. */
  async function inSession<T>(fn: (qr: QueryRunner) => Promise<T>): Promise<T> {
    const qr = db.createQueryRunner();
    try {
      return await fn(qr);
    } finally {
      await qr.query(`RESET ALL`); // la conexión vuelve al pool: no debe arrastrar los SET de la prueba
      await qr.release();
    }
  }

  async function explain(qr: QueryRunner, term: string): Promise<{ nodes: PlanNode[]; ms: number }> {
    const [row] = await qr.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${SEARCH_SQL}`, [term]);
    const [{ Plan, 'Execution Time': ms }] = row['QUERY PLAN'];
    return { nodes: flatten(Plan), ms };
  }

  const ids = async (qr: QueryRunner, term: string): Promise<string[]> =>
    (await qr.query(SEARCH_SQL, [term])).map((r: { id: string }) => r.id).sort();

  async function expectGinIndex(): Promise<void> {
    const rows = await db.query(
      `SELECT am.amname AS method, a.attname AS column
         FROM pg_index i
         JOIN pg_class ix ON ix.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_am am ON am.oid = ix.relam
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
        WHERE ix.relname = $1 AND t.relname = 'documents'`,
      [INDEX],
    );
    expect(rows).toEqual([{ method: 'gin', column: 'search_vector' }]);
  }

  run('AC-01: existe el índice GIN sobre documents.search_vector', expectGinIndex);

  run('AC-02: una palabra rara se resuelve con Bitmap Index Scan sobre el índice, sin Seq Scan', async () => {
    await inSession(async (qr) => {
      const { nodes, ms } = await explain(qr, RARE_WORD);
      expect(nodes.some((n) => n['Node Type'] === 'Bitmap Index Scan' && n['Index Name'] === INDEX)).toBe(true);
      expect(nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'documents')).toBe(false);
      expect(await ids(qr, RARE_WORD)).toHaveLength(SYNTHETIC_DOCS / RARE_EVERY);

      await qr.query(`SET enable_bitmapscan = off`);
      await qr.query(`SET enable_indexscan = off`);
      const { ms: withoutIndexMs } = await explain(qr, RARE_WORD);
      console.log(`${SYNTHETIC_DOCS} documentos, palabra rara: ${ms} ms con índice GIN, ${withoutIndexMs} ms sin índice`);
    });
  });

  run('AC-03: el índice no altera los resultados (término frecuente y raro)', async () => {
    await inSession(async (qr) => {
      for (const term of [FREQUENT_WORD, RARE_WORD]) {
        await qr.query(`RESET ALL`);
        await qr.query(`SET enable_seqscan = off`);
        const withIndex = await ids(qr, term);

        await qr.query(`RESET ALL`);
        await qr.query(`SET enable_bitmapscan = off`);
        await qr.query(`SET enable_indexscan = off`);
        const withoutIndex = await ids(qr, term);

        expect(withIndex.length).toBeGreaterThan(0);
        expect(withIndex).toEqual(withoutIndex);
      }
    });
  });

  run('AC-04: el UPDATE del Worker deja el contenido encontrable mediante el índice', async () => {
    const [{ id }] = await db.query(
      `INSERT INTO documents (title, author, category, tags, version, file_name, file_format, owner_id)
       VALUES ('Pendiente', 'Anónimo', 'General', '{}', '1.0', 'f.txt', 'TXT', $1) RETURNING id`,
      [ownerId],
    );
    const word = 'xilofonoraro';
    await inSession(async (qr) => {
      expect(await ids(qr, word)).toHaveLength(0);

      await qr.query(
        `UPDATE documents SET status = 'PROCESADO', content = $1, updated_at = now() WHERE id = $2`,
        [`Contenido con ${word} incorporado`, id],
      );

      const { nodes } = await explain(qr, word);
      expect(nodes.some((n) => n['Index Name'] === INDEX)).toBe(true);
      expect(await ids(qr, word)).toEqual([id]);
    });
  });

  run('AC-05: down y up del índice son válidos y las consultas no cambian', async () => {
    const before = await db.query(SEARCH_SQL, [RARE_WORD]);
    expect(before).toHaveLength(SYNTHETIC_DOCS / RARE_EVERY);

    await db.undoLastMigration();
    expect(await db.query(`SELECT 1 FROM pg_class WHERE relname = $1`, [INDEX])).toHaveLength(0);
    const without = await db.query(SEARCH_SQL, [RARE_WORD]);
    expect(without.map((r: { id: string }) => r.id).sort()).toEqual(before.map((r: { id: string }) => r.id).sort());

    await db.runMigrations();
    await expectGinIndex();
  });
});
