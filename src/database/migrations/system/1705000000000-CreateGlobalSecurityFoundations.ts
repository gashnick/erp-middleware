import { MigrationInterface, QueryRunner } from 'typeorm';

export default class CreateGlobalSecurityFoundations1705000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create Helper Functions in public schema
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.get_current_tenant_id() RETURNS TEXT AS $$
      BEGIN
        RETURN current_setting('app.tenant_id', true);
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION public.is_system_operation() RETURNS BOOLEAN AS $$
      BEGIN
        RETURN current_setting('app.tenant_id', true) LIKE 'SYSTEM_%';
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // 2. Define Shared System Tables
    const systemTables = [
      'users',
      'tenants',
      'audit_logs',
      'subscription',
      'subscription_plans',
      'connectors',
      'refreshtokens',
    ];

    // 3. Apply RLS to System Tables
    for (const table of systemTables) {
      await queryRunner.query(`
        DO $$ 
        BEGIN
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}') THEN
            ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;
            
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON public.%I', '${table}', '${table}');
            
            EXECUTE format('
              CREATE POLICY tenant_isolation_%I ON public.%I
              AS PERMISSIVE FOR ALL
              USING (public.is_system_operation() OR tenant_id::text = public.get_current_tenant_id())
              WITH CHECK (public.is_system_operation() OR tenant_id::text = public.get_current_tenant_id())', 
              '${table}', '${table}');
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const systemTables = [
      'users',
      'tenants',
      'audit_logs',
      'subscription',
      'subscription_plans',
      'connectors',
      'refreshtokens',
    ];

    for (const table of systemTables) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS public."${table}" DISABLE ROW LEVEL SECURITY;`,
      );
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS public.get_current_tenant_id() CASCADE;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.is_system_operation() CASCADE;`);
  }
}
