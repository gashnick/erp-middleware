import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAuditLogs1234567890124 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'action',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'resource_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'resource_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
            isNullable: false,
          },
          {
            name: 'user_agent',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'previous_hash',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'current_hash',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'timestamp',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true
    );

    // Indexes for fast querying
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_tenant_timestamp',
        columnNames: ['tenant_id', 'timestamp'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_user_timestamp',
        columnNames: ['user_id', 'timestamp'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_resource',
        columnNames: ['resource_type', 'resource_id'],
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_action',
        columnNames: ['action'],
      })
    );

    // Prevent updates and deletes (append-only enforcement)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'Audit logs are immutable - updates not allowed';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Audit logs are immutable - deletes not allowed';
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER audit_log_immutable
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_log_modification();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS audit_log_immutable ON audit_logs');
    await queryRunner.query('DROP FUNCTION IF EXISTS prevent_audit_log_modification');
    await queryRunner.dropTable('audit_logs');
  }
}
