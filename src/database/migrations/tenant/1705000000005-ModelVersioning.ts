// src/database/migrations/tenant/1705000000005-ModelVersioning.ts
//
// Adds model version tracking and rollback support:
//
//   prompt_templates:
//     - Add `version` integer column (default 1)
//     - Drop name-only unique constraint (one name can now have many versions)
//     - Add (name, version) unique constraint
//     - Add index on (name, is_active, version DESC) for fast active lookup
//
//   model_configs:
//     - New table storing active model override per provider
//     - One active row per provider at any time (enforced by partial unique index)
//     - Falls back to env var when no active row exists

export class ModelVersioning1705000000005 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`

      -- ── prompt_templates versioning ─────────────────────────────────────────

      ALTER TABLE "prompt_templates"
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

      -- Drop the old name-only unique constraint so multiple versions can coexist
      ALTER TABLE "prompt_templates"
        DROP CONSTRAINT IF EXISTS "UQ_prompt_templates_name";

      -- New constraint: one row per (name, version) combination
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_prompt_templates_name_version'
        ) THEN
          ALTER TABLE "prompt_templates"
            ADD CONSTRAINT "UQ_prompt_templates_name_version"
            UNIQUE ("name", "version");
        END IF;
      END $$;

      -- Fast lookup: find the active template with the highest version
      CREATE INDEX IF NOT EXISTS "IDX_PROMPT_TEMPLATES_ACTIVE"
        ON "prompt_templates" ("name", "is_active", "version" DESC);

      -- ── model_configs ────────────────────────────────────────────────────────
      --
      -- Stores per-provider model overrides.
      -- Only one row per provider can be active at a time (partial unique index).
      -- When no active row exists, the service falls back to the env var.

      CREATE TABLE IF NOT EXISTS "model_configs" (
        "id"         uuid      NOT NULL DEFAULT gen_random_uuid(),
        "provider"   varchar   NOT NULL
                       CHECK ("provider" IN ('openai', 'gemini')),
        "model_name" varchar   NOT NULL,
        "is_active"  boolean   NOT NULL DEFAULT true,
        "notes"      text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_model_configs" PRIMARY KEY ("id")
      );

      -- Only one active config per provider at a time
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MODEL_CONFIGS_ACTIVE_PROVIDER"
        ON "model_configs" ("provider")
        WHERE "is_active" = true;

      CREATE INDEX IF NOT EXISTS "IDX_MODEL_CONFIGS_PROVIDER"
        ON "model_configs" ("provider", "created_at" DESC);

    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`

      DROP TABLE IF EXISTS "model_configs";

      DROP INDEX IF EXISTS "IDX_PROMPT_TEMPLATES_ACTIVE";

      ALTER TABLE "prompt_templates"
        DROP CONSTRAINT IF EXISTS "UQ_prompt_templates_name_version";

      ALTER TABLE "prompt_templates"
        DROP COLUMN IF EXISTS "version";

      -- Restore original constraint (best effort — may fail if duplicates exist)
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_prompt_templates_name'
        ) THEN
          ALTER TABLE "prompt_templates"
            ADD CONSTRAINT "UQ_prompt_templates_name" UNIQUE ("name");
        END IF;
      END $$;

    `);
  }
}
