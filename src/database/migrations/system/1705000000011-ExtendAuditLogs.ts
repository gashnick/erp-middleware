import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendAuditLogs1705000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const alterations = [
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action TEXT`,
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS resource_type TEXT`,
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS resource_id TEXT`,
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT`,
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT`,
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT`,
      `ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS current_hash TEXT`,
    ];
    for (const sql of alterations) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.audit_logs 
        DROP COLUMN IF EXISTS action,
        DROP COLUMN IF EXISTS resource_type,
        DROP COLUMN IF EXISTS resource_id,
        DROP COLUMN IF EXISTS ip_address,
        DROP COLUMN IF EXISTS user_agent,
        DROP COLUMN IF EXISTS previous_hash,
        DROP COLUMN IF EXISTS current_hash
    `);
  }
}
