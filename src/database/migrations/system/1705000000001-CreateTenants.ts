import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantsTable1705000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await queryRunner.query(`
            CREATE TABLE "public"."tenants" (
                "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                "name" VARCHAR(255) NOT NULL,
                "slug" VARCHAR(100) UNIQUE NOT NULL,
                "schema_name" VARCHAR(100) UNIQUE NOT NULL,
                "status" VARCHAR(50) NOT NULL DEFAULT 'active',
                "tenant_secret" VARCHAR(255), -- Step 4: For per-tenant AES-256 encryption
                "owner_id" UUID,
                "created_at" TIMESTAMP DEFAULT NOW(),
                "updated_at" TIMESTAMP DEFAULT NOW()
            );
        `);

    await queryRunner.query(`CREATE INDEX "idx_tenants_slug" ON "public"."tenants"("slug");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public"."tenants" CASCADE;`);
  }
}
