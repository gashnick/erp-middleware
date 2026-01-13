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
        
        CONSTRAINT valid_role CHECK (role IN ('admin', 'manager', 'analyst', 'staff')),
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

    console.log('✅ Users table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.users CASCADE;`);
    console.log('✅ Users table dropped');
  }
}
