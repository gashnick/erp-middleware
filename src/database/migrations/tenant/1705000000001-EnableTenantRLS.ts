export class EnableTenantRLS1705000000001 {
  public async up(queryRunner: any): Promise<void> {
    // These tables exist inside the unique tenant schema
    const tenantTables = [
      'contacts',
      'invoices',
      'products',
      'orders',
      'quarantine_records',
      'ai_insights',
    ];

    for (const table of tenantTables) {
      await queryRunner.query(`
        DO $$ 
        BEGIN
          -- Only apply to the current tenant schema
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}') THEN
            ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
            
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', '${table}', '${table}');
            
            EXECUTE format('
              CREATE POLICY tenant_isolation_%I ON %I
              AS PERMISSIVE FOR ALL
              USING (public.is_system_operation() OR tenant_id::text = public.get_current_tenant_id())
              WITH CHECK (public.is_system_operation() OR tenant_id::text = public.get_current_tenant_id())', 
              '${table}', '${table}');
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: any): Promise<void> {
    const tenantTables = [
      'contacts',
      'invoices',
      'products',
      'orders',
      'quarantine_records',
      'ai_insights',
    ];
    for (const table of tenantTables) {
      await queryRunner.query(`ALTER TABLE IF EXISTS "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
  }
}
