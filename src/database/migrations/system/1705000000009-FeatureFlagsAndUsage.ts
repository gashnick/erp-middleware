// src/database/migrations/public/1705000000006-FeatureFlagsAndUsage.ts
//
// Adds granular feature flag and usage tracking infrastructure.
//
// Why not use subscription_plans boolean columns:
//   The existing boolean flags (ai_insights_enabled, etc.) can only express
//   on/off. They cannot express "500 chat queries per month" or "50 exports
//   per month". feature_flags adds limit_value + limit_unit for this.
//
// Tables added (public schema — shared across all tenants):
//   feature_flags  — one row per (plan_slug, feature) defining limits
//   usage_records  — tracks actual usage per tenant per feature per month
//
// Columns added:
//   public.tenants.max_seats  — seat cap per plan
//   public.users.seat_active  — whether this user occupies a seat

import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeatureFlagsAndUsage1705000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── feature_flags ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "plan_slug"   VARCHAR     NOT NULL,
        "feature"     VARCHAR     NOT NULL,
        "enabled"     BOOLEAN     NOT NULL DEFAULT false,
        "limit_value" INTEGER,              -- NULL = unlimited
        "limit_unit"  VARCHAR,              -- 'per_month' | 'per_day' | 'total' | NULL
        "created_at"  TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feature_flags" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_feature_flags" UNIQUE ("plan_slug", "feature"),
        CONSTRAINT "FK_feature_flags_plan"
          FOREIGN KEY ("plan_slug")
          REFERENCES "public"."subscription_plans"("slug")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_FEATURE_FLAGS_PLAN"
        ON "public"."feature_flags" ("plan_slug");
    `);

    // ── usage_records ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "public"."usage_records" (
        "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id"  UUID        NOT NULL,
        "feature"    VARCHAR     NOT NULL,
        "used"       INTEGER     NOT NULL DEFAULT 0,
        "period"     VARCHAR(7)  NOT NULL, -- 'YYYY-MM'
        "created_at" TIMESTAMP   NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_usage_records" UNIQUE ("tenant_id", "feature", "period"),
        CONSTRAINT "FK_usage_records_tenant"
          FOREIGN KEY ("tenant_id")
          REFERENCES "public"."tenants"("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_USAGE_RECORDS_TENANT_PERIOD"
        ON "public"."usage_records" ("tenant_id", "period");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_USAGE_RECORDS_FEATURE_PERIOD"
        ON "public"."usage_records" ("feature", "period");
    `);

    // ── seat management columns ──────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "public"."tenants"
        ADD COLUMN IF NOT EXISTS "max_seats" INTEGER NOT NULL DEFAULT 5;
    `);

    await queryRunner.query(`
      ALTER TABLE "public"."users"
        ADD COLUMN IF NOT EXISTS "seat_active" BOOLEAN NOT NULL DEFAULT true;
    `);

    // ── seed feature flags for all four plan tiers ───────────────────────────
    await queryRunner.query(`
      INSERT INTO "public"."feature_flags"
        ("plan_slug", "feature", "enabled", "limit_value", "limit_unit")
      VALUES
        -- free
        ('free', 'chat_queries',      true,  100,  'per_month'),
        ('free', 'exports',           false, null,  null),
        ('free', 'whatsapp',          false, null,  null),
        ('free', 'scheduled_reports', false, null,  null),
        ('free', 'connectors',        true,  1,    'total'),
        ('free', 'alert_rules',       false, null,  null),
        ('free', 'hr_dashboard',      false, null,  null),
        ('free', 'ops_dashboard',     false, null,  null),

        -- basic
        ('basic', 'chat_queries',      true,  500,  'per_month'),
        ('basic', 'exports',           true,  50,   'per_month'),
        ('basic', 'whatsapp',          false, null,  null),
        ('basic', 'scheduled_reports', true,  5,    'total'),
        ('basic', 'connectors',        true,  3,    'total'),
        ('basic', 'alert_rules',       true,  10,   'total'),
        ('basic', 'hr_dashboard',      true,  null,  null),
        ('basic', 'ops_dashboard',     false, null,  null),

        -- standard
        ('standard', 'chat_queries',      true,  2000, 'per_month'),
        ('standard', 'exports',           true,  200,  'per_month'),
        ('standard', 'whatsapp',          true,  1,    'total'),
        ('standard', 'scheduled_reports', true,  20,   'total'),
        ('standard', 'connectors',        true,  10,   'total'),
        ('standard', 'alert_rules',       true,  50,   'total'),
        ('standard', 'hr_dashboard',      true,  null,  null),
        ('standard', 'ops_dashboard',     true,  null,  null),

        -- enterprise
        ('enterprise', 'chat_queries',      true,  null, null),
        ('enterprise', 'exports',           true,  null, null),
        ('enterprise', 'whatsapp',          true,  null, null),
        ('enterprise', 'scheduled_reports', true,  null, null),
        ('enterprise', 'connectors',        true,  null, null),
        ('enterprise', 'alert_rules',       true,  null, null),
        ('enterprise', 'hr_dashboard',      true,  null, null),
        ('enterprise', 'ops_dashboard',     true,  null, null)

      ON CONFLICT ("plan_slug", "feature") DO UPDATE SET
        enabled     = EXCLUDED.enabled,
        limit_value = EXCLUDED.limit_value,
        limit_unit  = EXCLUDED.limit_unit;
    `);

    // ── update max_seats per plan tier ───────────────────────────────────────
    await queryRunner.query(`
      UPDATE "public"."tenants" t
      SET "max_seats" = CASE sp.slug
        WHEN 'free'       THEN 2
        WHEN 'basic'      THEN 5
        WHEN 'standard'   THEN 15
        WHEN 'enterprise' THEN 999
        ELSE 5
      END
      FROM "public"."subscriptions" s
      JOIN "public"."subscription_plans" sp ON s.plan_id = sp.id
      WHERE s.tenant_id = t.id
        AND s.status IN ('active', 'trial');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "public"."users" DROP COLUMN IF EXISTS "seat_active"`);
    await queryRunner.query(`ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS "max_seats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "public"."usage_records" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "public"."feature_flags" CASCADE`);
  }
}
