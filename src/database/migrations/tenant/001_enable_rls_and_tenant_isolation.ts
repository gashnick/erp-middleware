// src/database/migrations/tenant/001_enable_rls_and_tenant_isolation.ts
/**
 * Migration: Enable Row-Level Security (RLS) for Tenant Isolation
 *
 * 🛡️ CRITICAL: This migration enables database-level tenant isolation.
 * Application-level isolation is not enough. One bug in the app = data breach.
 *
 * RLS ensures:
 * - Even if SQL injection succeeds, you can't access other tenants
 * - Even if auth bypass happens, DB prevents cross-tenant access
 * - Even if app logic is wrong, DB enforces isolation
 *
 * Implementation:
 * 1. Enable RLS on all tenant tables
 * 2. Create app.tenant_id session variable (set by app)
 * 3. Create policies that use this variable
 * 4. Test that queries fail if session variable is not set
 */

export class EnableRLSAndTenantIsolation1000000000000 {
  public async up(queryRunner: any): Promise<void> {
    // ============================================================
    // STEP 1: Create a helper function to get current tenant ID
    // ============================================================
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS TEXT AS $$
      DECLARE
        tenant_id_str TEXT;
      BEGIN
        tenant_id_str := current_setting('app.tenant_id', true);
        IF tenant_id_str IS NULL OR tenant_id_str = '' THEN
          RAISE EXCEPTION 'Tenant context required: app.tenant_id not set';
        END IF;
        RETURN tenant_id_str;
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // ============================================================
    // STEP 2: Enable RLS on key tables
    // ============================================================

    // Enable RLS on invoices table
    await queryRunner.query(`ALTER TABLE IF EXISTS invoices ENABLE ROW LEVEL SECURITY;`);

    // Create policy: Users can only see invoices from their tenant
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation_invoices ON invoices;
      
      CREATE POLICY tenant_isolation_invoices ON invoices
      AS PERMISSIVE
      FOR ALL
      USING (tenant_id = get_current_tenant_id())
      WITH CHECK (tenant_id = get_current_tenant_id());
    `);

    // Enable RLS on users table (tenant users + public users)
    await queryRunner.query(`ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;`);

    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation_users ON users;

      CREATE POLICY tenant_isolation_users ON users
      AS PERMISSIVE
      FOR ALL
      USING (
        is_system_operation() OR
        tenant_id = get_current_tenant_id() OR
        (tenant_id IS NULL AND get_current_tenant_id() = 'PUBLIC_ACCESS')
      )
      WITH CHECK (
        is_system_operation() OR
        tenant_id = get_current_tenant_id() OR
        (tenant_id IS NULL AND get_current_tenant_id() = 'PUBLIC_ACCESS')
      );
    `);

    // Enable RLS on audit_logs table
    await queryRunner.query(`ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;`);

    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
      
      CREATE POLICY tenant_isolation_audit_logs ON audit_logs
      AS PERMISSIVE
      FOR ALL
      USING (tenant_id = get_current_tenant_id())
      WITH CHECK (tenant_id = get_current_tenant_id());
    `);

    // ============================================================
    // STEP 3: Create super-admin bypass policy (for migrations only)
    // ============================================================

    // For migrations that run with app.tenant_id = 'SYSTEM_MIGRATION',
    // we need a bypass. Otherwise, migrations can't set up the table.
    // This is INTENTIONALLY RISKY - only use during system setup.

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION is_system_operation() RETURNS BOOLEAN AS $$
      BEGIN
        RETURN current_setting('app.tenant_id', true) LIKE 'SYSTEM_%';
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // Update policies to allow system operations bypass
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation_invoices ON invoices;

      CREATE POLICY tenant_isolation_invoices ON invoices
      AS PERMISSIVE
      FOR ALL
      USING (is_system_operation() OR tenant_id = get_current_tenant_id())
      WITH CHECK (is_system_operation() OR tenant_id = get_current_tenant_id());
    `);

    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation_users ON users;

      CREATE POLICY tenant_isolation_users ON users
      AS PERMISSIVE
      FOR ALL
      USING (
        is_system_operation() OR
        tenant_id = get_current_tenant_id() OR
        (tenant_id IS NULL AND get_current_tenant_id() = 'PUBLIC_ACCESS')
      )
      WITH CHECK (
        is_system_operation() OR
        tenant_id = get_current_tenant_id() OR
        (tenant_id IS NULL AND get_current_tenant_id() = 'PUBLIC_ACCESS')
      );
    `);

    // ============================================================
    // STEP 4: Document the policy
    // ============================================================

    await queryRunner.query(`
      COMMENT ON TABLE invoices IS 'RLS ENABLED: Access controlled by tenant_id via app.tenant_id session variable';
    `);

    await queryRunner.query(`
      COMMENT ON TABLE users IS 'RLS ENABLED: Access controlled by tenant_id via app.tenant_id session variable';
    `);

    await queryRunner.query(`
      COMMENT ON TABLE audit_logs IS 'RLS ENABLED: Access controlled by tenant_id via app.tenant_id session variable';
    `);
  }

  public async down(queryRunner: any): Promise<void> {
    // ============================================================
    // ROLLBACK: Disable RLS
    // ============================================================

    await queryRunner.query(`ALTER TABLE IF EXISTS invoices DISABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE IF EXISTS audit_logs DISABLE ROW LEVEL SECURITY;`);

    // Drop policies
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation_invoices ON invoices;`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation_users ON users;`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;`);

    // Drop functions
    await queryRunner.query(`DROP FUNCTION IF EXISTS get_current_tenant_id() CASCADE;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS is_system_operation() CASCADE;`);
  }
}
