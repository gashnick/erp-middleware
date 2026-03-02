export class AddInvoiceFingerprint1705000000002 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "fingerprint" text GENERATED ALWAYS AS (
          encode(sha256((
            COALESCE(vendor_id::text, '') || 
            amount::text ||
            date_trunc('day', invoice_date - (
              (EXTRACT(DOW FROM invoice_date)::int % 3) * INTERVAL '1 day'
            ))::text
          )::bytea), 'hex')
        ) STORED
    `);
    
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_INVOICES_FINGERPRINT" ON "invoices" ("fingerprint")
    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_INVOICES_FINGERPRINT"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "fingerprint"`);
  }
}
