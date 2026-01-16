import { QueryRunner } from 'typeorm';

/**
 * Tenant Schema Template
 *
 * This is NOT a migration - it's a utility class used by tenant-connection.service.ts
 * to create tenant schemas dynamically when new tenants register.
 *
 * Usage:
 *   const template = new TenantSchemaTemplate();
 *   await template.createSchema(queryRunner, 'tenant_abc123');
 */

export class TenantSchemaTemplate {
  /**
   * Creates a complete tenant schema with all tables
   */
  async createSchema(queryRunner: QueryRunner, schemaName: string): Promise<void> {
    console.log(`Creating tenant schema: ${schemaName}`);

    // Create schema
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName};`);

    // Grant schema access to tenant_schema_role for DB-level isolation
    await queryRunner.query(`GRANT USAGE ON SCHEMA ${schemaName} TO tenant_schema_role;`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaName} TO tenant_schema_role;`,
    );
    await queryRunner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schemaName} TO tenant_schema_role;`,
    );

    // Set default privileges for future tables
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_schema_role;`,
    );
    await queryRunner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT USAGE, SELECT ON SEQUENCES TO tenant_schema_role;`,
    );

    // Create invoices table
    await this.createInvoicesTable(queryRunner, schemaName);

    // Create payments table
    await this.createPaymentsTable(queryRunner, schemaName);

    // Create expenses table
    await this.createExpensesTable(queryRunner, schemaName);

    // Create ai_insights table
    await this.createAiInsightsTable(queryRunner, schemaName);

    // Create upload_batches table
    await this.createUploadBatchesTable(queryRunner, schemaName);

    console.log(`✅ Tenant schema '${schemaName}' created with role permissions`);
  }

  /**
   * Drops a tenant schema and all its tables
   */
  async dropSchema(queryRunner: QueryRunner, schemaName: string): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
    console.log(`✅ Tenant schema '${schemaName}' dropped`);
  }

  private async createInvoicesTable(queryRunner: QueryRunner, schemaName: string): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${schemaName}.invoices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number  VARCHAR(100) NOT NULL,
        customer_name   VARCHAR(255) NOT NULL,
        customer_email  VARCHAR(255),
        amount          DECIMAL(15, 2) NOT NULL,
        currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
        tax_amount      DECIMAL(15, 2) DEFAULT 0,
        total_amount    DECIMAL(15, 2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
        issue_date      DATE NOT NULL,
        due_date        DATE NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'draft',
        notes           TEXT,
        metadata        JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_invoice_status CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
        CONSTRAINT valid_invoice_amount CHECK (amount >= 0),
        CONSTRAINT valid_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT unique_invoice_number UNIQUE (invoice_number)
      );
    `);

    // Create indexes
    await queryRunner.query(`CREATE INDEX idx_invoices_status ON ${schemaName}.invoices(status);`);
    await queryRunner.query(
      `CREATE INDEX idx_invoices_due_date ON ${schemaName}.invoices(due_date) WHERE status != 'paid';`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_invoices_customer ON ${schemaName}.invoices(customer_name);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_invoices_created ON ${schemaName}.invoices(created_at DESC);`,
    );
  }

  private async createPaymentsTable(queryRunner: QueryRunner, schemaName: string): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${schemaName}.payments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_number  VARCHAR(100) NOT NULL,
        invoice_id      UUID REFERENCES ${schemaName}.invoices(id) ON DELETE SET NULL,
        amount          DECIMAL(15, 2) NOT NULL,
        currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
        method          VARCHAR(50) NOT NULL,
        transaction_id  VARCHAR(255),
        payment_date    DATE NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'pending',
        notes           TEXT,
        metadata        JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_payment_status CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
        CONSTRAINT valid_payment_amount CHECK (amount >= 0),
        CONSTRAINT unique_payment_number UNIQUE (payment_number)
      );
    `);

    // Create indexes
    await queryRunner.query(
      `CREATE INDEX idx_payments_invoice ON ${schemaName}.payments(invoice_id);`,
    );
    await queryRunner.query(`CREATE INDEX idx_payments_status ON ${schemaName}.payments(status);`);
    await queryRunner.query(
      `CREATE INDEX idx_payments_date ON ${schemaName}.payments(payment_date DESC);`,
    );
    await queryRunner.query(`CREATE INDEX idx_payments_method ON ${schemaName}.payments(method);`);
  }

  private async createExpensesTable(queryRunner: QueryRunner, schemaName: string): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${schemaName}.expenses (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        expense_number  VARCHAR(100) NOT NULL,
        category        VARCHAR(100) NOT NULL,
        vendor_name     VARCHAR(255),
        amount          DECIMAL(15, 2) NOT NULL,
        currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
        expense_date    DATE NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'pending',
        description     TEXT,
        receipt_url     TEXT,
        metadata        JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_expense_status CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
        CONSTRAINT valid_expense_amount CHECK (amount >= 0),
        CONSTRAINT unique_expense_number UNIQUE (expense_number)
      );
    `);

    // Create indexes
    await queryRunner.query(
      `CREATE INDEX idx_expenses_category ON ${schemaName}.expenses(category);`,
    );
    await queryRunner.query(`CREATE INDEX idx_expenses_status ON ${schemaName}.expenses(status);`);
    await queryRunner.query(
      `CREATE INDEX idx_expenses_date ON ${schemaName}.expenses(expense_date DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_expenses_vendor ON ${schemaName}.expenses(vendor_name);`,
    );
  }

  private async createAiInsightsTable(queryRunner: QueryRunner, schemaName: string): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${schemaName}.ai_insights (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        insight_type    VARCHAR(50) NOT NULL,
        scope           VARCHAR(50) NOT NULL,
        title           VARCHAR(255) NOT NULL,
        summary         TEXT NOT NULL,
        details         JSONB NOT NULL,
        confidence      DECIMAL(3, 2),
        priority        VARCHAR(20),
        status          VARCHAR(20) NOT NULL DEFAULT 'new',
        valid_until     TIMESTAMP,
        metadata        JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_insight_type CHECK (insight_type IN ('summary', 'anomaly', 'forecast', 'recommendation')),
        CONSTRAINT valid_insight_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
        CONSTRAINT valid_insight_status CHECK (status IN ('new', 'viewed', 'acknowledged', 'dismissed'))
      );
    `);

    // Create indexes
    await queryRunner.query(
      `CREATE INDEX idx_insights_type ON ${schemaName}.ai_insights(insight_type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_insights_status ON ${schemaName}.ai_insights(status) WHERE status = 'new';`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_insights_priority ON ${schemaName}.ai_insights(priority, created_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_insights_created ON ${schemaName}.ai_insights(created_at DESC);`,
    );
  }

  private async createUploadBatchesTable(
    queryRunner: QueryRunner,
    schemaName: string,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${schemaName}.upload_batches (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        connector_id        UUID NOT NULL,
        file_name           VARCHAR(255) NOT NULL,
        file_size_bytes     BIGINT NOT NULL,
        template_type       VARCHAR(50) NOT NULL,
        total_rows          INTEGER NOT NULL,
        valid_rows          INTEGER NOT NULL,
        error_rows          INTEGER NOT NULL,
        warning_rows        INTEGER NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'validating',
        validation_errors   JSONB,
        uploaded_by         UUID NOT NULL,
        approved_by         UUID,
        approved_at         TIMESTAMP,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_upload_status CHECK (status IN ('validating', 'approved', 'imported', 'failed'))
      );
    `);

    // Create indexes
    await queryRunner.query(
      `CREATE INDEX idx_uploads_status ON ${schemaName}.upload_batches(status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_uploads_created ON ${schemaName}.upload_batches(created_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_uploads_user ON ${schemaName}.upload_batches(uploaded_by);`,
    );
  }
}
