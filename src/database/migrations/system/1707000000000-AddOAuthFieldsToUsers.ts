import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOAuthFieldsToUsers1707000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add OAuth provider field
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'oauth_provider',
        type: 'varchar',
        length: '50',
        isNullable: true,
      }),
    );

    // Add OAuth provider ID field
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'oauth_provider_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    // Add profile picture field
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'profile_picture',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
    );

    // Make password_hash nullable for OAuth users
    await queryRunner.changeColumn(
      'users',
      'password_hash',
      new TableColumn({
        name: 'password_hash',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    // Create index on oauth_provider_id for faster lookups
    await queryRunner.query(`
      CREATE INDEX idx_users_oauth_provider_id 
      ON users(oauth_provider, oauth_provider_id) 
      WHERE oauth_provider IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_oauth_provider_id`);

    // Remove OAuth fields
    await queryRunner.dropColumn('users', 'profile_picture');
    await queryRunner.dropColumn('users', 'oauth_provider_id');
    await queryRunner.dropColumn('users', 'oauth_provider');

    // Revert password_hash to NOT NULL
    await queryRunner.changeColumn(
      'users',
      'password_hash',
      new TableColumn({
        name: 'password_hash',
        type: 'varchar',
        length: '255',
        isNullable: false,
      }),
    );
  }
}
