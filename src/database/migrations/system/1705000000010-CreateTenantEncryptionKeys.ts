import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTenantEncryptionKeys1705000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'tenant_encryption_keys',
        schema: 'public',
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
            isNullable: false,
          },
          {
            name: 'encrypted_dek',
            type: 'text',
            isNullable: false,
            comment: 'Data Encryption Key encrypted by KMS CMK',
          },
          {
            name: 'key_version',
            type: 'int',
            default: 1,
            comment: 'For key rotation tracking',
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'rotated_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        // foreign key will be added explicitly below to ensure schema-qualified
        // reference to the tenants table (avoids search_path issues and ordering
        // problems with mixed SQL/TS migrations).
      }),
      true,
    );

    // Add schema-qualified foreign key constraint explicitly so the SQL refers
    // to the fully-qualified table name: public.tenants
    await queryRunner.query(
      `ALTER TABLE public.tenant_encryption_keys
         ADD CONSTRAINT FK_tenant_encryption_keys_tenant_id
         FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;`,
    );

    await queryRunner.createIndex(
      'tenant_encryption_keys',
      new TableIndex({
        name: 'IDX_tenant_encryption_keys_tenant_active',
        columnNames: ['tenant_id', 'is_active'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('tenant_encryption_keys');
  }
}
