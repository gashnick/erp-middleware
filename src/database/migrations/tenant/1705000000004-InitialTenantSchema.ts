import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class InitialTenantSchema1705000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Customers/Vendors
    await queryRunner.createTable(
      new Table({
        name: 'contacts',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'name', type: 'text' }, // Changed to text for encryption padding
          { name: 'external_id', type: 'varchar', isNullable: true }, // For QB/Odoo sync
          { name: 'contact_info', type: 'jsonb', isNullable: true },
          { name: 'is_encrypted', type: 'boolean', default: false }, // Security tracking
          { name: 'type', type: 'varchar' },
        ],
      }),
      true,
    );

    // 2. Invoices (Updated for Dashboard & AI)
    await queryRunner.createTable(
      new Table({
        name: 'invoices',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'invoice_number', type: 'text', isNullable: true }, // Encrypted
          { name: 'customer_name', type: 'text', isNullable: true }, // Encrypted
          { name: 'amount', type: 'decimal', precision: 15, scale: 2 },
          { name: 'is_encrypted', type: 'boolean', default: 'false' },
          { name: 'external_id', type: 'varchar', isNullable: true }, // Mapping to ERP
          { name: 'currency', type: 'varchar', length: '10', default: "'USD'" },
          { name: 'due_date', type: 'timestamp', isNullable: true },
          { name: 'status', type: 'varchar', default: "'draft'" },
          { name: 'metadata', type: 'jsonb', isNullable: true }, // Store AI confidence scores here
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    // 6. AI Insights (NEW: Satisfies "Anomalies Preview Panel")
    await queryRunner.createTable(
      new Table({
        name: 'ai_insights',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'target_entity', type: 'varchar' }, // 'invoices' or 'orders'
          { name: 'target_id', type: 'uuid' }, // The specific record ID
          { name: 'insight_type', type: 'varchar' }, // 'anomaly', 'prediction', 'risk'
          { name: 'message', type: 'text' }, // "Potential duplicate detected"
          { name: 'confidence', type: 'decimal', precision: 3, scale: 2 }, // 0.0 to 1.0
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    // 3. Products
    await queryRunner.createTable(
      new Table({
        name: 'products',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'name', type: 'varchar' },
          { name: 'price', type: 'decimal', precision: 15, scale: 2 },
          { name: 'stock', type: 'integer', default: 0 },
        ],
      }),
      true,
    );

    // 4. Orders
    await queryRunner.createTable(
      new Table({
        name: 'orders',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'channel', type: 'varchar' },
          { name: 'amount', type: 'decimal', precision: 15, scale: 2 },
          { name: 'status', type: 'varchar' },
          { name: 'items', type: 'jsonb' },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    // 5. Quarantine (Added for Reliability)
    await queryRunner.createTable(
      new Table({
        name: 'quarantine_records',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'source_type', type: 'varchar' }, // e.g., 'csv', 'quickbooks'
          { name: 'raw_data', type: 'jsonb' }, // Store the messy original data
          { name: 'errors', type: 'jsonb' }, // Store the reasons why it failed
          { name: 'status', type: 'varchar', default: "'pending'" }, // For the "Fix UI"
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('quarantine_records');
    await queryRunner.dropTable('orders');
    await queryRunner.dropTable('products');
    await queryRunner.dropTable('invoices');
    await queryRunner.dropTable('contacts');
  }
}
