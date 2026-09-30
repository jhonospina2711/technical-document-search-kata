import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice GIN sobre `documents.search_vector` (KTL-15) para que las consultas `@@` con
 * `websearch_to_tsquery('documents_es', ...)` no recorran toda la tabla. Índice completo (no parcial):
 * `status = 'PROCESADO'` se aplica como filtro de la consulta. Sin `CONCURRENTLY` porque TypeORM ejecuta
 * la migración en transacción; con volumen real habría que construirlo fuera de ella.
 */
export class AddDocumentSearchVectorIndex1790000000003 implements MigrationInterface {
  name = 'AddDocumentSearchVectorIndex1790000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "idx_documents_search_vector" ON "documents" USING GIN ("search_vector")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_documents_search_vector"`);
  }
}
