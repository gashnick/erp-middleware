export class EnableTenantRLS1705000000001 {
  public async up(queryRunner: any): Promise<void> {
    const tenantTables = [
      'contacts',
      'invoices',
      'expenses',
      'bank_transactions',
      'products',
      'orders',
      'quarantine_records',
      'ai_insights',
      'chat_sessions',
      'chat_messages',
      'anomalies',
      'kg_entities',
      'kg_relationships',
      'insight_feedback',
      'prompt_templates',
    ];

    for (const table of tenantTables) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema()
            AND table_name = '${table}'
          ) THEN
            ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;

            DROP POLICY IF EXISTS schema_isolation ON "${table}";

            -- Policy uses current_schema() — no tenant_id column needed.
            -- Allows access only when the connection's search_path matches
            -- the schema this table actually lives in.
            CREATE POLICY schema_isolation ON "${table}"
              AS PERMISSIVE FOR ALL
              USING (current_schema() = (
                SELECT table_schema
                FROM information_schema.tables
                WHERE table_name = '${table}'
                LIMIT 1
              ));
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: any): Promise<void> {
    const tenantTables = [
      'contacts',
      'invoices',
      'expenses',
      'bank_transactions',
      'products',
      'orders',
      'quarantine_records',
      'ai_insights',
      'chat_sessions',
      'chat_messages',
      'anomalies',
      'kg_entities',
      'kg_relationships',
      'insight_feedback',
    ];

    for (const table of tenantTables) {
      await queryRunner.query(`ALTER TABLE IF EXISTS "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
  }
}
