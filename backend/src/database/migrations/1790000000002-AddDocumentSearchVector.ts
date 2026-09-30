import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vector de búsqueda Full-Text de `documents` (KTL-14). Lo mantiene un trigger, así el `UPDATE` único
 * del Worker (estado + contenido) deja el vector calculado sin cambiar el Worker. Una columna
 * `GENERATED` no es viable: `unaccent` y `array_to_string` no son inmutables.
 *
 * Pesos: A título, B etiquetas y categoría, C autor, D contenido. Del contenido solo se indexan los
 * primeros 500 000 caracteres: un `tsvector` admite ~1 MB y un texto largo con muchos lexemas distintos
 * haría fallar el `UPDATE` del Worker. El contenido completo sigue almacenado.
 *
 * Las consultas deben usar la misma configuración: `websearch_to_tsquery('documents_es', ...)`.
 */
export class AddDocumentSearchVector1790000000002 implements MigrationInterface {
  name = 'AddDocumentSearchVector1790000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await queryRunner.query(`CREATE TEXT SEARCH CONFIGURATION documents_es (COPY = spanish)`);
    await queryRunner.query(`
      ALTER TEXT SEARCH CONFIGURATION documents_es
        ALTER MAPPING FOR asciiword, word, hword, hword_asciipart, hword_part
        WITH unaccent, spanish_stem
    `);
    await queryRunner.query(`ALTER TABLE "documents" ADD COLUMN "search_vector" tsvector`);
    await queryRunner.query(`
      CREATE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('documents_es', coalesce(NEW.title, '')), 'A') ||
          setweight(to_tsvector('documents_es',
            coalesce(array_to_string(NEW.tags, ' '), '') || ' ' || coalesce(NEW.category, '')), 'B') ||
          setweight(to_tsvector('documents_es', coalesce(NEW.author, '')), 'C') ||
          setweight(to_tsvector('documents_es', left(coalesce(NEW.content, ''), 500000)), 'D');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_documents_search_vector
        BEFORE INSERT OR UPDATE OF title, author, category, tags, content ON "documents"
        FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update()
    `);
    // Backfill: el trigger recalcula el vector de las filas existentes (no altera updated_at).
    await queryRunner.query(`UPDATE "documents" SET "title" = "title"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER trg_documents_search_vector ON "documents"`);
    await queryRunner.query(`DROP FUNCTION documents_search_vector_update()`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "search_vector"`);
    await queryRunner.query(`DROP TEXT SEARCH CONFIGURATION documents_es`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS unaccent`);
  }
}
