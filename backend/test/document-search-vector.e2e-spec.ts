import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { postgresConnection } from '../src/database/postgres-connection';
import { DocumentOrmEntity } from '../src/documents/infrastructure/document.orm-entity';

config({ path: ['.env', '../.env'] });

interface NewDoc {
  title?: string;
  author?: string;
  category?: string;
  tags?: string[];
  content?: string | null;
}

/**
 * `search_vector` (KTL-14) contra PostgreSQL real en una base temporal migrada: configuración
 * `documents_es`, pesos, trigger y backfill. Se omite si PostgreSQL no está disponible.
 */
describe('search_vector de documents (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_test_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let available = false;
  let ownerId: string;

  beforeAll(async () => {
    admin = new DataSource({ ...connection, database: 'postgres' });
    try {
      await admin.initialize();
    } catch {
      console.warn('PostgreSQL no disponible: se omite la prueba de search_vector');
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
  });

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

  async function insert(doc: NewDoc = {}): Promise<string> {
    const [{ id }] = await db.query(
      `INSERT INTO documents (title, author, category, tags, version, file_name, file_format, content, owner_id)
       VALUES ($1, $2, $3, $4, '1.0', 'f.txt', 'TXT', $5, $6) RETURNING id`,
      [doc.title ?? 'Sin título', doc.author ?? 'Anónimo', doc.category ?? 'General', doc.tags ?? [], doc.content ?? null, ownerId],
    );
    return id;
  }

  async function matches(id: string, query: string): Promise<boolean> {
    const [row] = await db.query(
      `SELECT search_vector @@ websearch_to_tsquery('documents_es', $1) AS m FROM documents WHERE id = $2`,
      [query, id],
    );
    return row.m === true;
  }

  async function rank(id: string, query: string): Promise<number> {
    const [row] = await db.query(
      `SELECT ts_rank(search_vector, websearch_to_tsquery('documents_es', $1)) AS r FROM documents WHERE id = $2`,
      [query, id],
    );
    return Number(row.r);
  }

  const vectorOf = async (id: string): Promise<string | null> =>
    (await db.query(`SELECT search_vector::text AS v FROM documents WHERE id = $1`, [id]))[0].v;

  run('AC-01: existen la columna tsvector, la configuración documents_es, el trigger y unaccent', async () => {
    const [col] = await db.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'search_vector'`,
    );
    expect(col.data_type).toBe('tsvector');
    expect(await db.query(`SELECT 1 FROM pg_ts_config WHERE cfgname = 'documents_es'`)).toHaveLength(1);
    expect(await db.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'trg_documents_search_vector' AND NOT tgisinternal`)).toHaveLength(1);
    expect(await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'unaccent'`)).toHaveLength(1);
  });

  run('AC-02: acentos y plurales se resuelven con la configuración', async () => {
    const id = await insert({ content: 'Configuración de los servidores de producción' });
    expect(await matches(id, 'configuracion servidor')).toBe(true);
    expect(await matches(id, 'configuración servidores')).toBe(true);
    expect(await matches(id, 'inexistente')).toBe(false);
  });

  run('AC-03: el título puntúa más que el contenido; etiquetas/categoría más que el autor', async () => {
    const inTitle = await insert({ title: 'Guía de kubernetes' });
    const inContent = await insert({ content: 'Notas sobre kubernetes en producción' });
    expect(await rank(inTitle, 'kubernetes')).toBeGreaterThan(await rank(inContent, 'kubernetes'));

    const inTags = await insert({ tags: ['redis'] });
    const inCategory = await insert({ category: 'redis' });
    const inAuthor = await insert({ author: 'redis' });
    expect(await rank(inTags, 'redis')).toBeGreaterThan(await rank(inAuthor, 'redis'));
    expect(await rank(inCategory, 'redis')).toBeGreaterThan(await rank(inAuthor, 'redis'));
  });

  run('AC-04: con contenido nulo se busca por título y etiquetas, no por contenido', async () => {
    const id = await insert({ title: 'Manual de Redis', tags: ['postgres'], content: null });
    expect(await matches(id, 'redis')).toBe(true);
    expect(await matches(id, 'postgres')).toBe(true);
    expect(await matches(id, 'latencia')).toBe(false);
  });

  run('AC-05: el UPDATE del Worker incorpora el contenido al vector', async () => {
    const id = await insert({ title: 'Informe' });
    expect(await matches(id, 'latencia')).toBe(false);

    await db.query(
      `UPDATE documents SET status = 'PROCESADO', content = 'La latencia media es baja', updated_at = now() WHERE id = $1`,
      [id],
    );

    expect(await matches(id, 'latencia')).toBe(true);
  });

  run('AC-06: el vector solo se recalcula si cambian título, metadatos o contenido', async () => {
    const id = await insert({ title: 'Original', content: 'texto base' });
    const before = await vectorOf(id);
    expect(before).toBeTruthy();

    await db.query(`UPDATE documents SET status = 'PROCESADO', updated_at = now() WHERE id = $1`, [id]);
    expect(await vectorOf(id)).toBe(before);

    await db.query(`UPDATE documents SET title = 'Renombrado' WHERE id = $1`, [id]);
    expect(await vectorOf(id)).not.toBe(before);
    expect(await matches(id, 'renombrado')).toBe(true);
    expect(await matches(id, 'original')).toBe(false);
  });

  run(
    'AC-07: un contenido de 5 MB con tokens casi todos distintos no falla y solo se indexa el inicio',
    async () => {
      const token = (i: number) => {
        let s = '';
        let n = i;
        do {
          s = String.fromCharCode(97 + (n % 26)) + s;
          n = Math.floor(n / 26);
        } while (n > 0);
        return `zq${s.padStart(6, 'a')}`;
      };
      const parts: string[] = [];
      let size = 0;
      for (let i = 0; size < 5 * 1024 * 1024; i++) {
        const t = token(i);
        parts.push(t);
        size += t.length + 1;
      }
      const content = parts.join(' ');
      const first = parts[0];
      const last = parts[parts.length - 1];
      const id = await insert({ title: 'Grande' });

      const start = Date.now();
      await db.query(`UPDATE documents SET status = 'PROCESADO', content = $1, updated_at = now() WHERE id = $2`, [content, id]);
      console.log(`UPDATE con 5 MB de contenido y trigger: ${Date.now() - start} ms`);

      expect(await vectorOf(id)).toBeTruthy();
      expect(await matches(id, first)).toBe(true);
      expect(await matches(id, last)).toBe(false);
    },
    120_000,
  );

  run('AC-08 y AC-09: down/up de la migración, con backfill de filas previas', async () => {
    await db.undoLastMigration(); // índice GIN (KTL-15), posterior a search_vector
    await db.undoLastMigration();
    const [gone] = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'search_vector'`,
    );
    expect(gone.n).toBe(0);

    const id = await insert({ title: 'Documento previo', content: 'contenido anterior a la migración' });

    await db.runMigrations();

    expect(await vectorOf(id)).toBeTruthy();
    expect(await matches(id, 'previo')).toBe(true);
    expect(await matches(id, 'migracion')).toBe(true);
    expect(await db.query(`SELECT 1 FROM pg_ts_config WHERE cfgname = 'documents_es'`)).toHaveLength(1);
  });
});
