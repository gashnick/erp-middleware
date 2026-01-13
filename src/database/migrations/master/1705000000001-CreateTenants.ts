import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenants1705000000001 implements MigrationInterface {
  name = 'CreateTenants1705000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create tenants table
    await queryRunner.query(`
      CREATE TABLE public.tenants (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        schema_name         VARCHAR(63) UNIQUE NOT NULL,
        company_name        VARCHAR(255) NOT NULL,
        data_source_type    VARCHAR(20) NOT NULL,
        subscription_plan   VARCHAR(50) NOT NULL,
        plan_limits         JSONB NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMP,
        
        CONSTRAINT valid_data_source CHECK (data_source_type IN ('internal', 'external')),
        CONSTRAINT valid_plan CHECK (subscription_plan IN ('basic', 'standard', 'enterprise')),
        CONSTRAINT valid_status CHECK (status IN ('active', 'suspended', 'cancelled'))
      );
    `);

    // Create indexes for tenants
    await queryRunner.query(`
      CREATE INDEX idx_tenants_status ON public.tenants(status) WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_tenants_schema ON public.tenants(schema_name);
    `);

    console.log('✅ Tenants table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.tenants CASCADE;`);
    console.log('✅ Tenants table dropped');
  }
}
