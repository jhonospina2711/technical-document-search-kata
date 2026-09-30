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

interface Seed {
  title?: string;
  author?: string;
  category?: string;
  tags?: string[];
  content?: string | null;
  status?: string;
  format?: string;
  createdAt?: string;
}

interface Item {
  id: string;
  title: string;
  score: number;
  snippet: { segments: { text: string; highlight: boolean }[]; truncatedStart: boolean; truncatedEnd: boolean };
}

/**
 * Levanta la aplicación completa sobre una base temporal (nunca la de desarrollo) y prueba
 * `GET /search` de extremo a extremo: FTS, ranking, highlighting y paginación sobre PostgreSQL real.
 * Se omite si PostgreSQL no está disponible.
 */
describe('GET /search (PostgreSQL real)', () => {
  const connection = postgresConnection(process.env);
  const testDb = `docsearch_search_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let uploadDir: string;
  let tokenA: string;
  let tokenB: string;
  let ownerA: string;
  let available = false;

  const insert = async (seed: Seed = {}): Promise<string> => {
    const [row] = await db.query(
      `INSERT INTO documents (title, author, category, tags, version, file_name, file_format, status, content, owner_id, created_at)
       VALUES ($1, $2, $3, $4, '1.0.0', 'doc.md', $5, $6, $7, $8, COALESCE($9::timestamptz, now())) RETURNING id`,
      [
        seed.title ?? 'Documento genérico',
        seed.author ?? 'Ana',
        seed.category ?? 'General',
        seed.tags ?? [],
        seed.format ?? 'MD',
        seed.status ?? 'PROCESADO',
        seed.content === undefined ? 'texto sin relevancia' : seed.content,
        ownerA,
        seed.createdAt ?? null,
      ],
    );
    return row.id as string;
  };
  const search = (params: Record<string, string | number>, token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).get('/search').query(params);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const items = async (params: Record<string, string | number>): Promise<Item[]> =>
    (await search(params).expect(200)).body.items as Item[];
  const titles = async (params: Record<string, string | number>): Promise<string[]> =>
    (await items(params)).map((item) => item.title);
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
      console.warn('PostgreSQL no disponible: se omite la prueba e2e de GET /search');
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

    uploadDir = await mkdtemp(join(tmpdir(), 'docsearch-search-'));
    Object.assign(process.env, { POSTGRES_DB: testDb, UPLOAD_DIR: uploadDir });
    // Import diferido: `ConfigModule.forRoot` lee el entorno al cargar el módulo.
    const { AppModule } = await import('../src/app.module');
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

  beforeEach(async () => {
    if (available) await db.query('TRUNCATE documents');
  });

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
      60_000,
    );

  run('busca un término en cualquier campo y devuelve el contrato (AC-01)', async () => {
    const id = await insert({
      title: 'Guía de despliegue',
      author: 'Ana',
      tags: ['infra'],
      content: 'Despliegue sobre kubernetes en producción',
      format: 'PDF',
    });
    await insert({ title: 'Otro', content: 'nada que ver' });

    const { body } = await search({ q: 'kubernetes' }).expect(200);

    expect(body).toEqual({
      items: [
        {
          id,
          title: 'Guía de despliegue',
          author: 'Ana',
          format: 'PDF',
          version: '1.0.0',
          tags: ['infra'],
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
          score: expect.any(Number),
          snippet: {
            segments: [
              { text: 'Despliegue sobre ', highlight: false },
              { text: 'kubernetes', highlight: true },
              { text: ' en producción', highlight: false },
            ],
            truncatedStart: false,
            truncatedEnd: false,
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      tookMs: expect.any(Number),
      pendingCount: 0,
    });
    expect(body.items[0].score).toBeGreaterThan(0);
    expect(body.items[0].score).toBeLessThan(1);
  });

  run('resuelve acentos, plural y orden de palabras (AC-02)', async () => {
    await insert({ title: 'Manual', content: 'Configuración de los servidores de producción' });

    expect(await titles({ q: 'configuracion servidor' })).toEqual(['Manual']);
    expect(await titles({ q: 'SERVIDORES configuración' })).toEqual(['Manual']);
  });

  run('las frases entre comillas exigen palabras adyacentes (AC-03)', async () => {
    await insert({ title: 'Adyacente', content: 'Clusters con alta disponibilidad garantizada' });
    await insert({ title: 'Separadas', content: 'Alta carga de trabajo y baja disponibilidad' });

    expect(await titles({ q: '"alta disponibilidad"' })).toEqual(['Adyacente']);
    expect((await titles({ q: 'alta disponibilidad' })).sort()).toEqual(['Adyacente', 'Separadas']);
  });

  run('busca en título, etiquetas, autor y contenido y ordena A > B > C > D (AC-04)', async () => {
    await insert({ title: 'Nada uno', content: 'sin relación' });
    await insert({ title: 'En contenido', content: 'se usa redis aquí' });
    await insert({ title: 'En autor', author: 'Redis Pérez' });
    await insert({ title: 'En etiqueta', tags: ['redis'] });
    await insert({ title: 'Redis' });

    const result = await items({ q: 'redis' });

    expect(result.map((item) => item.title)).toEqual(['Redis', 'En etiqueta', 'En autor', 'En contenido']);
    const scores = result.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(new Set(scores).size).toBe(4);
  });

  run('solo devuelve PROCESADO y cuenta los PROCESANDO (AC-05)', async () => {
    await insert({ title: 'Visible kafka' });
    await insert({ title: 'Procesando kafka', status: 'PROCESANDO', content: null });
    await insert({ title: 'Procesando otro', status: 'PROCESANDO', content: null });
    await insert({ title: 'Fallido kafka', status: 'ERROR', content: null });

    const { body } = await search({ q: 'kafka' }).expect(200);

    expect(body.items.map((item: Item) => item.title)).toEqual(['Visible kafka']);
    expect(body.total).toBe(1);
    expect(body.pendingCount).toBe(2);
  });

  run('resalta solo los términos y marca el truncado del fragmento (AC-06)', async () => {
    await insert({
      title: 'Largo',
      content: `${'inicio '.repeat(100)}kubernetes${' final'.repeat(100)}`,
    });
    await insert({ title: 'Corto', content: 'Despliegue kubernetes producción' });

    const result = await items({ q: 'kubernetes' });
    const long = result.find((item) => item.title === 'Largo')!;
    const short = result.find((item) => item.title === 'Corto')!;

    expect(long.snippet.truncatedStart).toBe(true);
    expect(long.snippet.truncatedEnd).toBe(true);
    expect(short.snippet.truncatedStart).toBe(false);
    expect(short.snippet.truncatedEnd).toBe(false);
    for (const { snippet } of result) {
      const highlighted = snippet.segments.filter((segment) => segment.highlight);
      expect(highlighted.length).toBeGreaterThan(0);
      expect(highlighted.every((segment) => /kubernetes/i.test(segment.text))).toBe(true);
      const text = snippet.segments.map((segment) => segment.text).join('');
      expect(text).not.toMatch(/[\u0001\u0002]/); // eslint-disable-line no-control-regex
    }
  });

  run('si la coincidencia está solo en metadatos, el fragmento no lleva resaltado', async () => {
    await insert({ title: 'Guía nginx', content: 'Texto del documento sin el término del título' });

    const [item] = await items({ q: 'nginx' });

    expect(item.snippet.segments.every((segment) => !segment.highlight)).toBe(true);
    expect(item.snippet.segments.map((segment) => segment.text).join('')).toContain('Texto del documento');
  });

  run('el fragmento es texto plano: ts_headline descarta las etiquetas HTML del contenido (AC-07)', async () => {
    await insert({ content: '<script>alert(1)</script> usa redis con <b>negrita</b> y <i>cursiva</i> fin de línea' });

    const [item] = await items({ q: 'redis' });

    const text = item.snippet.segments.map((segment) => segment.text).join('');
    expect(text).toContain('redis');
    expect(text).not.toMatch(/<\/?(script|b|i)>/);
    expect(item.snippet.segments.some((segment) => segment.highlight && /redis/i.test(segment.text))).toBe(true);
  });

  run('pagina 24 resultados sin repetir ni omitir (AC-08)', async () => {
    for (let i = 1; i <= 24; i++) {
      await insert({ title: `Doc ${String(i).padStart(2, '0')}`, tags: ['paginado'] });
    }

    const pages: string[][] = [];
    for (const page of [1, 2, 3]) {
      const { body } = await search({ q: 'paginado', sort: 'title', page }).expect(200);
      expect(body).toMatchObject({ total: 24, page, pageSize: 10 });
      pages.push(body.items.map((item: Item) => item.title));
    }

    expect(pages.map((p) => p.length)).toEqual([10, 10, 4]);
    const all = pages.flat();
    expect(new Set(all).size).toBe(24);
    expect(all).toEqual([...all].sort());
    const beyond = (await search({ q: 'paginado', page: 4 }).expect(200)).body;
    expect(beyond).toMatchObject({ items: [], total: 24, page: 4, pageSize: 10 });
  });

  run('ordena por fecha y por título con desempate por id (AC-09)', async () => {
    await insert({ title: 'Beta guia', createdAt: '2026-01-01T00:00:00Z' });
    await insert({ title: 'Alfa guia', createdAt: '2026-03-01T00:00:00Z' });
    await insert({ title: 'Gamma guia', createdAt: '2026-02-01T00:00:00Z' });

    expect(await titles({ q: 'guia', sort: 'date-desc' })).toEqual(['Alfa guia', 'Gamma guia', 'Beta guia']);
    expect(await titles({ q: 'guia', sort: 'date-asc' })).toEqual(['Beta guia', 'Gamma guia', 'Alfa guia']);
    expect(await titles({ q: 'guia', sort: 'title' })).toEqual(['Alfa guia', 'Beta guia', 'Gamma guia']);
    const byRelevance = await items({ q: 'guia' });
    const scores = byRelevance.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  run('rechaza parámetros inválidos con 400 (AC-10)', async () => {
    const invalid: Record<string, string | number>[] = [
      {},
      { q: '' },
      { q: '   ' },
      { q: 'a'.repeat(201) },
      { q: 'abc\u0000def' },
      { q: 'x', sort: 'xyz' },
      { q: 'x', page: 0 },
      { q: 'x', page: 'abc' },
      { q: 'x', page: 10001 },
      { q: 'x', pageSize: 0 },
      { q: 'x', pageSize: 51 },
      { q: 'x', filter: 'pdf' },
    ];

    for (const params of invalid) {
      await search(params).expect(400);
    }
  });

  run('tolera sintaxis de tsquery e intentos de inyección sin 500 (AC-11)', async () => {
    await insert({ title: 'Intacto' });
    const hostile = [`a & | ! : ' ( )`, `'; DROP TABLE documents;--`, 'redis:*', '"sin cerrar', '!!!', '-', 'or or or'];

    for (const q of hostile) {
      const { body } = await search({ q }).expect(200);
      expect(Array.isArray(body.items)).toBe(true);
    }
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM documents');
    expect(count).toBe(1);
  });

  run('una consulta de solo stop words devuelve vacío (AC-12)', async () => {
    await insert({ content: 'de la casa' });

    const { body } = await search({ q: 'de la' }).expect(200);

    expect(body).toMatchObject({ items: [], total: 0 });
  });

  run('sin token o con token inválido: 401 incluso con parámetros inválidos (AC-13)', async () => {
    await search({ q: 'x' }, null).expect(401);
    await search({}, null).expect(401);
    await search({ q: 'x' }, 'basura').expect(401);
  });

  run('otro usuario autenticado encuentra los documentos (búsqueda global, AC-14)', async () => {
    await insert({ title: 'De Ada con terraform' });

    const { body } = await search({ q: 'terraform' }, tokenB).expect(200);

    expect(body.total).toBe(1);
  });

  run('el fragmento de un contenido enorme es corto y no se devuelve el contenido (AC-18)', async () => {
    const filler = 'palabra '.repeat(60_000);
    await insert({ title: 'Enorme', content: `${filler}kubernetes ${filler}kubernetes ${filler}` });

    const response = await search({ q: 'kubernetes' }).expect(200);
    const [item] = response.body.items as Item[];

    const text = item.snippet.segments.map((segment) => segment.text).join('');
    expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(response.body).length).toBeLessThan(5_000);
  });

  run('la paginación respeta el orden de relevancia entre páginas (AC-19)', async () => {
    for (let i = 1; i <= 24; i++) {
      await insert({ title: `Doc ${i}`, content: `${'prometheus '.repeat(i)}${'relleno '.repeat(30)}` });
    }

    const collect = async (pageSize: number): Promise<Item[]> => {
      const all: Item[] = [];
      for (let page = 1; (page - 1) * pageSize < 24; page++) {
        all.push(...(await items({ q: 'prometheus', pageSize, page })));
      }
      return all;
    };
    const tens = await collect(10);
    const fives = await collect(5);

    expect(tens).toHaveLength(24);
    const scores = tens.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(fives.map((item) => item.id)).toEqual(tens.map((item) => item.id));
  });
});
