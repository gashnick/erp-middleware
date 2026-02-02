import { MigrationInterface, QueryRunner } from 'typeorm';

export default class InitialTenantSchema1705000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // We use raw SQL to ensure TypeORM doesn't force a 'public' schema check
    await queryRunner.query(`
      CREATE TABLE "contacts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" text NOT NULL,
        "external_id" varchar,
        "contact_info" jsonb,
        "is_encrypted" boolean NOT NULL DEFAULT false,
        "type" varchar NOT NULL,
        CONSTRAINT "PK_contacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contacts_tenant" FOREIGN KEY ("tenant_id") REFERENCES public.tenants("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "IDX_CONTACT_TENANT_EXT" ON "contacts" ("tenant_id", "external_id");

      CREATE TABLE "invoices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "invoice_number" text,
        "customer_name" text,
        "amount" decimal(15,2) NOT NULL,
        "is_encrypted" boolean NOT NULL DEFAULT false,
        "external_id" varchar,
        "currency" varchar(10) NOT NULL DEFAULT 'USD',
        "due_date" timestamp,
        "status" varchar NOT NULL DEFAULT 'draft',
        "metadata" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoices_tenant" FOREIGN KEY ("tenant_id") REFERENCES public.tenants("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "IDX_INVOICE_TENANT_EXT" ON "invoices" ("tenant_id", "external_id");

      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar NOT NULL,
        "external_id" varchar,
        "price" decimal(15,2) NOT NULL,
        "stock" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "FK_products_tenant" FOREIGN KEY ("tenant_id") REFERENCES public.tenants("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "IDX_PRODUCT_TENANT_EXT" ON "products" ("tenant_id", "external_id");

      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "external_id" varchar,
        "channel" varchar NOT NULL,
        "amount" decimal(15,2) NOT NULL,
        "status" varchar NOT NULL,
        "items" jsonb NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES public.tenants("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "IDX_ORDER_TENANT_EXT" ON "orders" ("tenant_id", "external_id");

      CREATE TABLE "quarantine_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "source_type" varchar NOT NULL,
        "raw_data" jsonb NOT NULL,
        "errors" jsonb NOT NULL,
        "status" varchar NOT NULL DEFAULT 'pending',
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quarantine" PRIMARY KEY ("id"),
        CONSTRAINT "FK_quarantine_tenant" FOREIGN KEY ("tenant_id") 
          REFERENCES public.tenants("id") ON DELETE CASCADE
      );

      -- ✅ NO UNIQUE INDEX - quarantine is a log, not a deduplication table
      -- Index for performance only:
      CREATE INDEX "IDX_QUARANTINE_TENANT_STATUS" ON "quarantine_records"
      ("tenant_id", "status", "created_at");

      CREATE TABLE "ai_insights" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "target_entity" varchar NOT NULL,
        "target_id" uuid NOT NULL,
        "insight_type" varchar NOT NULL,
        "message" text NOT NULL,
        "confidence" decimal(3,2) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_insights" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_insights_tenant" FOREIGN KEY ("tenant_id") REFERENCES public.tenants("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "ai_insights";
      DROP TABLE IF EXISTS "quarantine_records";
      DROP TABLE IF EXISTS "orders";
      DROP TABLE IF EXISTS "products";
      DROP TABLE IF EXISTS "invoices";
      DROP TABLE IF EXISTS "contacts";
    `);
  }
}
