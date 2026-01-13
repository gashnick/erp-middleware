import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectors1705000000004 implements MigrationInterface {
  name = 'CreateConnectors1705000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create connectors table
    await queryRunner.query(`
      CREATE TABLE public.connectors (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        name            VARCHAR(255) NOT NULL,
        type            VARCHAR(50) NOT NULL,
        config          JSONB NOT NULL DEFAULT '{}',
        status          VARCHAR(20) NOT NULL DEFAULT 'active',
        last_sync_at    TIMESTAMP,
        next_sync_at    TIMESTAMP,
        sync_frequency  VARCHAR(50) DEFAULT 'manual',
        error_message   TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_connector_type CHECK (type IN ('csv_upload', 'postgres', 'quickbooks')),
        CONSTRAINT valid_connector_status CHECK (status IN ('active', 'paused', 'error'))
      );
    `);

    // Create indexes for connectors
    await queryRunner.query(`
      CREATE INDEX idx_connectors_tenant ON public.connectors(tenant_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_connectors_status ON public.connectors(tenant_id, status);
    `);

    console.log('✅ Connectors table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.connectors CASCADE;`);
    console.log('✅ Connectors table dropped');
  }
}
