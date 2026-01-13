import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1705000000005 implements MigrationInterface {
  name = 'CreateAuditLogs1705000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create audit_logs table
    await queryRunner.query(`
      CREATE TABLE public.audit_logs (
        id              BIGSERIAL PRIMARY KEY,
        tenant_id       UUID NOT NULL,
        user_id         UUID,
        action          VARCHAR(100) NOT NULL,
        resource_type   VARCHAR(50),
        resource_id     UUID,
        ip_address      INET,
        user_agent      TEXT,
        metadata        JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Create indexes for audit_logs
    await queryRunner.query(`
      CREATE INDEX idx_audit_tenant_action ON public.audit_logs(tenant_id, action);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_audit_user ON public.audit_logs(user_id) WHERE user_id IS NOT NULL;
    `);

    console.log('✅ Audit logs table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.audit_logs CASCADE;`);
    console.log('✅ Audit logs table dropped');
  }
}
