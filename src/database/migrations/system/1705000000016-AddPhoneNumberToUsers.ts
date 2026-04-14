import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhoneNumberToUsers1705000000016 implements MigrationInterface {
  name = 'AddPhoneNumberToUsers1705000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add phone_number column to users table — globally unique
    // Phone numbers are the first piece of identity WhatsApp provides
    // and must be unique across all users and tenants
    await queryRunner.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
    `);

    // Global unique constraint on phone_number (allowing NULL for email-only users)
    // E.164 format: +<1-3 digits country code><1-14 digits local number>
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_number_unique
      ON public.users(phone_number)
      WHERE phone_number IS NOT NULL AND deleted_at IS NULL;
    `);

    // Index for fast phone lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_phone_number
      ON public.users(phone_number)
      WHERE phone_number IS NOT NULL AND deleted_at IS NULL;
    `);

    // Validate phone number format (E.164)
    await queryRunner.query(`
      ALTER TABLE public.users
      ADD CONSTRAINT valid_phone_number_format
      CHECK (phone_number IS NULL OR phone_number ~ '^\\+[1-9]\\d{1,14}$');
    `);

    console.log('✅ Phone number column added to users table with global uniqueness constraint');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove phone number column and constraints
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_users_phone_number;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_users_phone_number_unique;
    `);

    await queryRunner.query(`
      ALTER TABLE public.users
      DROP CONSTRAINT IF EXISTS valid_phone_number_format;
    `);

    await queryRunner.query(`
      ALTER TABLE public.users
      DROP COLUMN IF EXISTS phone_number;
    `);

    console.log('✅ Phone number column removed from users table');
  }
}
