import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1705000000002 implements MigrationInterface {
  name = 'CreateUsers1705000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.query(`
      CREATE TABLE public.users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        email           VARCHAR(255) NOT NULL,
        password_hash   VARCHAR(255) NOT NULL,
        full_name       VARCHAR(255) NOT NULL,
        role            VARCHAR(50) NOT NULL DEFAULT 'staff',
        status          VARCHAR(20) NOT NULL DEFAULT 'active',
        last_login_at   TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMP,
        
        CONSTRAINT valid_role CHECK (role IN ('ADMIN', 'MANAGER', 'ANALYST', 'STAFF')),
        CONSTRAINT valid_user_status CHECK (status IN ('active', 'inactive', 'invited')),
        CONSTRAINT unique_email_per_tenant UNIQUE (tenant_id, email)
      );
    `);

    // Create indexes for users
    await queryRunner.query(`
      CREATE INDEX idx_users_tenant ON public.users(tenant_id) WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_users_email ON public.users(email) WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_users_status ON public.users(tenant_id, status);
    `);
    // Inside CreateUsers migration or a new one
    await queryRunner.query(`
      ALTER TABLE "public"."tenants" 
      ADD CONSTRAINT "fk_tenant_owner" 
      FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") 
      ON DELETE SET NULL;
`);

    // In your migration file
    await queryRunner.query(`
  ALTER TABLE public.users ALTER COLUMN tenant_id DROP NOT NULL;
`);

    await queryRunner.query(`
  CREATE UNIQUE INDEX idx_unique_email_null_tenant 
  ON public.users(email) 
  WHERE tenant_id IS NULL;
`);

    console.log('✅ Users table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove the constraint from the tenants table first
    await queryRunner.query(
      `ALTER TABLE "public"."tenants" DROP CONSTRAINT IF EXISTS "fk_tenant_owner"`,
    );
    // 2. Now drop the table
    await queryRunner.query(`DROP TABLE IF EXISTS public.users CASCADE;`);
    console.log('✅ Users table dropped');
  }
}
