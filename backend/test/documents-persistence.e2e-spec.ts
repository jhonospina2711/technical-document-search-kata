import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { postgresConnection } from '../src/database/postgres-connection';
import { createDocument, DocumentFormat, DocumentStatus } from '../src/documents/domain/document';
import { DocumentOrmEntity } from '../src/documents/infrastructure/document.orm-entity';

config({ path: ['.env', '../.env'] });

const metadata = {
  title: 'Guía de despliegue',
  author: 'Ada',
  category: 'Operaciones',
  tags: ['docker', 'ci'],
  version: '1.0',
  fileName: 'guia.md',
  fileFormat: DocumentFormat.MD,
};

/**
 * Migra una base temporal (nunca la de desarrollo) y prueba `documents` contra PostgreSQL real.
 * Se omite si PostgreSQL no está disponible.
 */
describe('Persistencia de documents (PostgreSQL real)', () => {
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
      console.warn('PostgreSQL no disponible: se omite la prueba de persistencia de documents');
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

  const run = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!available) return;
      await fn();
    });

  run('inserta y lee un documento: id generado, estado inicial, etiquetas y fechas', async () => {
    const repo = db.getRepository(DocumentOrmEntity);
    const saved = await repo.save(repo.create({ ...createDocument({ ...metadata, ownerId }) }));

    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(found.status).toBe(DocumentStatus.PROCESANDO);
    expect(found.content).toBeNull();
    expect(found.tags).toEqual(['docker', 'ci']);
    expect(found.createdAt).toBeInstanceOf(Date);
    expect(found.updatedAt).toBeInstanceOf(Date);
  });

  run('aplica el estado por defecto y etiquetas vacías si no se informan', async () => {
    const [{ id }] = await db.query(
      `INSERT INTO documents (title, author, category, version, file_name, file_format, owner_id)
       VALUES ('t', 'a', 'c', '1', 'f.txt', 'TXT', $1) RETURNING id`,
      [ownerId],
    );
    const [row] = await db.query(`SELECT status, tags FROM documents WHERE id = $1`, [id]);
    expect(row).toEqual({ status: 'PROCESANDO', tags: [] });
  });

  run('rechaza un estado fuera del catálogo', async () => {
    await expect(
      db.query(
        `INSERT INTO documents (title, author, category, version, file_name, file_format, status, owner_id)
         VALUES ('t', 'a', 'c', '1', 'f.txt', 'TXT', 'INDEXED', $1)`,
        [ownerId],
      ),
    ).rejects.toThrow(/CHK_documents_status/);
  });

  run('rechaza un formato de archivo fuera del catálogo', async () => {
    await expect(
      db.query(
        `INSERT INTO documents (title, author, category, version, file_name, file_format, owner_id)
         VALUES ('t', 'a', 'c', '1', 'f.docx', 'DOCX', $1)`,
        [ownerId],
      ),
    ).rejects.toThrow(/CHK_documents_file_format/);
  });

  run('rechaza un owner_id que no existe en users', async () => {
    await expect(
      db.query(
        `INSERT INTO documents (title, author, category, version, file_name, file_format, owner_id)
         VALUES ('t', 'a', 'c', '1', 'f.txt', 'TXT', gen_random_uuid())`,
      ),
    ).rejects.toThrow(/FK_documents_owner_id/);
  });

  run('revertir la migración elimina la tabla documents', async () => {
    await db.undoLastMigration(); // AddDocumentSearchVector (depende de la tabla)
    await db.undoLastMigration(); // CreateDocuments
    const [{ exists }] = await db.query(`SELECT to_regclass('public.documents') IS NOT NULL AS exists`);
    expect(exists).toBe(false);
    await db.runMigrations();
    const [{ restored }] = await db.query(`SELECT to_regclass('public.documents') IS NOT NULL AS restored`);
    expect(restored).toBe(true);
  });
});
