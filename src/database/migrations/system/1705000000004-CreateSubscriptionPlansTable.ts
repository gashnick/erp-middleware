import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAndSeedSubscriptionPlans1705000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create Table
    await queryRunner.query(`
      CREATE TABLE "public"."subscription_plans" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" VARCHAR(100) UNIQUE NOT NULL,
        "slug" VARCHAR(100) UNIQUE NOT NULL,
        "description" TEXT,
        "price_monthly" DECIMAL(10,2) NOT NULL,
        "price_yearly" DECIMAL(10,2),
        "currency" VARCHAR(3) DEFAULT 'USD',
        "max_users" INTEGER NOT NULL,
        "max_storage_gb" INTEGER NOT NULL,
        "max_monthly_invoices" INTEGER NOT NULL,
        "max_api_calls_monthly" INTEGER NOT NULL,
        "ai_insights_enabled" BOOLEAN DEFAULT FALSE,
        "advanced_reporting_enabled" BOOLEAN DEFAULT FALSE,
        "priority_support_enabled" BOOLEAN DEFAULT FALSE,
        "custom_branding_enabled" BOOLEAN DEFAULT FALSE,
        "api_access_enabled" BOOLEAN DEFAULT FALSE,
        "is_active" BOOLEAN DEFAULT TRUE,
        "is_public" BOOLEAN DEFAULT TRUE,
        "trial_days" INTEGER DEFAULT 0,
        "sort_order" INTEGER DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_subscription_plans_slug" ON "public"."subscription_plans"("slug");`,
    );

    // 2. Seed All 4 Tiers
    await queryRunner.query(`
      INSERT INTO "public"."subscription_plans" 
      (name, slug, description, price_monthly, max_users, max_storage_gb, max_monthly_invoices, max_api_calls_monthly, trial_days, sort_order)
      VALUES 
      ('Free Tier', 'free', 'Trial period for new users', 0.00, 2, 1, 10, 100, 0, 0),
      ('Basic', 'basic', 'Small teams', 19.00, 3, 5, 50, 1000, 14, 1),
      ('Standard', 'standard', 'Growing businesses', 49.00, 10, 50, 500, 10000, 14, 2),
      ('Enterprise', 'enterprise', 'Large organizations', 149.00, -1, 500, -1, 100000, 14, 3);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public"."subscription_plans" CASCADE;`);
  }
}
