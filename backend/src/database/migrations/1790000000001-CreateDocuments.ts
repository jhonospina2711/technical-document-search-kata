import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocuments1790000000001 implements MigrationInterface {
  name = 'CreateDocuments1790000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" text NOT NULL,
        "author" text NOT NULL,
        "category" text NOT NULL,
        "tags" text array NOT NULL DEFAULT '{}',
        "version" text NOT NULL,
        "file_name" text NOT NULL,
        "file_format" text NOT NULL,
        "status" text NOT NULL DEFAULT 'PROCESANDO',
        "content" text,
        "owner_id" uuid NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_documents_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_documents_file_format" CHECK ("file_format" IN ('TXT', 'PDF', 'MD')),
        CONSTRAINT "CHK_documents_status" CHECK ("status" IN ('PROCESANDO', 'PROCESADO', 'ERROR')),
        CONSTRAINT "FK_documents_owner_id" FOREIGN KEY ("owner_id") REFERENCES "users" ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_documents_owner_id" ON "documents" ("owner_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_documents_status" ON "documents" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_documents_status"`);
    await queryRunner.query(`DROP INDEX "IDX_documents_owner_id"`);
    await queryRunner.query(`DROP TABLE "documents"`);
  }
}
