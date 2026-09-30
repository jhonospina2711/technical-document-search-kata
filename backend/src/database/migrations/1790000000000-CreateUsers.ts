import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1790000000000 implements MigrationInterface {
  name = 'CreateUsers1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" text NOT NULL,
        "name" text NOT NULL,
        "password" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "roles" text array NOT NULL DEFAULT '{user}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
    // Evita duplicados que solo difieren en mayúsculas.
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email_lower" ON "users" (lower("email"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_users_email_lower"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
