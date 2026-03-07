// src/database/migrations/tenant/1705000000004-FixUniqueIndexesForUpsert.ts
//
// Problem: ON CONFLICT (external_id) requires a non-partial unique index.
// The original schema used partial unique indexes (WHERE external_id IS NOT NULL)
// which PostgreSQL cannot use as an ON CONFLICT target.
//
// Fix: Replace partial indexes with full unique indexes on external_id columns.
// NULL values are handled at the application layer (ETL transformer) — records
// without an external_id are rejected before reaching the upsert.

export class FixUniqueIndexesForUpsert1705000000004 {
  public async up(queryRunner: any): Promise<void> {
    // ── products ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_PRODUCT_EXT";
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_PRODUCT_EXT"
        ON "products" ("external_id")
        WHERE "external_id" IS NOT NULL;
    `);
    // Add a plain unique constraint that ON CONFLICT can target
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "UQ_products_external_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "UQ_products_external_id"
        UNIQUE ("external_id");
    `);

    // ── contacts ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_CONTACT_EXT";
    `);
    await queryRunner.query(`
      ALTER TABLE "contacts"
        DROP CONSTRAINT IF EXISTS "UQ_contacts_external_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "contacts"
        ADD CONSTRAINT "UQ_contacts_external_id"
        UNIQUE ("external_id");
    `);

    // ── invoices ──────────────────────────────────────────────────────────────
    // invoices already has a non-partial unique index from the original migration
    // but we add the constraint form as a safety net
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP CONSTRAINT IF EXISTS "UQ_invoices_external_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD CONSTRAINT "UQ_invoices_external_id"
        UNIQUE ("external_id");
    `);

    // ── orders ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ORDER_EXT";
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "UQ_orders_external_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "UQ_orders_external_id"
        UNIQUE ("external_id");
    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "UQ_products_external_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "UQ_contacts_external_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "UQ_invoices_external_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders"   DROP CONSTRAINT IF EXISTS "UQ_orders_external_id"`,
    );

    // Restore partial indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_PRODUCT_EXT" ON "products" ("external_id") WHERE "external_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_CONTACT_EXT" ON "contacts" ("external_id") WHERE "external_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ORDER_EXT"   ON "orders"   ("external_id") WHERE "external_id" IS NOT NULL`,
    );
  }
}
