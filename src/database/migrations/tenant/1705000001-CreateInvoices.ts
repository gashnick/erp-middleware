// src/database/migrations/tenant/1705000001-CreateInvoices.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create Invoices Table
 *
 * This migration runs once per tenant schema.
 */
export default class CreateInvoices1705000001 implements MigrationInterface {
  name = 'CreateInvoices1705000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get current schema from search_path
    const schemaResult = await queryRunner.query('SHOW search_path');
    const schemaName = schemaResult[0].search_path.split(',')[0].trim();

    console.log(`Creating invoices table in ${schemaName}`);

    await queryRunner.query(`
      CREATE TABLE invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number VARCHAR(100) NOT NULL UNIQUE,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        amount DECIMAL(15, 2) NOT NULL CHECK (amount >= 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        tax_amount DECIMAL(15, 2) DEFAULT 0 CHECK (tax_amount >= 0),
        total_amount DECIMAL(15, 2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        notes TEXT,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        
        CONSTRAINT valid_invoice_status CHECK (
          status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')
        ),
        CONSTRAINT valid_currency CHECK (currency ~ '^[A-Z]{3}$')
      );
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX idx_invoices_status ON invoices(status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoices_due_date ON invoices(due_date) 
      WHERE status != 'paid';
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoices_customer ON invoices(customer_name);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoices_created ON invoices(created_at DESC);
    `);

    console.log(`✅ Invoices table created in ${schemaName}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS invoices CASCADE;`);
  }
}
