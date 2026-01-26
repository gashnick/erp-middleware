import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class InitialTenantSchema1705000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Customers/Vendors
    await queryRunner.createTable(
      new Table({
        name: 'contacts',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'name', type: 'varchar' },
          { name: 'contact_info', type: 'jsonb', isNullable: true },
          { name: 'tags', type: 'text', isArray: true, isNullable: true },
          { name: 'type', type: 'varchar', comment: 'customer or vendor' },
        ],
      }),
      true,
    );

    // 2. Invoices
    await queryRunner.createTable(
      new Table({
        name: 'invoices',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'invoice_number', type: 'varchar', isNullable: true },
          { name: 'customer_name', type: 'varchar', isNullable: true },
          { name: 'amount', type: 'decimal', precision: 15, scale: 2 },
          { name: 'currency', type: 'varchar', length: '10', default: "'USD'" },
          { name: 'due_date', type: 'timestamp', isNullable: true },
          { name: 'status', type: 'varchar', default: "'draft'" },
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
