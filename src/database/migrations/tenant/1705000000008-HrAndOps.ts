// src/database/migrations/tenant/1705000000008-HrAndOps.ts
//
// Adds HR and Operations dashboard tables to each tenant schema.
//
// employees   — headcount, attrition, payroll source data
// assets      — operational asset tracking with uptime
// sla_configs — configurable SLA thresholds for ops alerting

export class HrAndOps1705000000008 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`

      -- ── HR ──────────────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "employees" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "external_id" varchar,
        "name"        text          NOT NULL,
        "department"  varchar       NOT NULL,
        "role"        varchar       NOT NULL,
        "status"      varchar       NOT NULL DEFAULT 'active'
          CHECK ("status" IN ('active', 'on_leave', 'terminated')),
        "start_date"  timestamp     NOT NULL,
        "end_date"    timestamp,
        "salary"      decimal(15,2),
        "currency"    varchar(10)   NOT NULL DEFAULT 'USD',
        "metadata"    jsonb         NOT NULL DEFAULT '{}',
        "created_at"  timestamp     NOT NULL DEFAULT now(),
        "updated_at"  timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employees" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_EMPLOYEE_EXT"
        ON "employees" ("external_id") WHERE "external_id" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS "IDX_EMPLOYEE_DEPT_STATUS"
        ON "employees" ("department", "status");
      CREATE INDEX IF NOT EXISTS "IDX_EMPLOYEE_START_DATE"
        ON "employees" ("start_date");

      -- ── Operations ───────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "assets" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "external_id"  varchar,
        "name"         varchar       NOT NULL,
        "category"     varchar       NOT NULL,
        "status"       varchar       NOT NULL DEFAULT 'operational'
          CHECK ("status" IN ('operational', 'maintenance', 'offline', 'retired')),
        "uptime_pct"   decimal(5,2),
        "last_service" timestamp,
        "next_service" timestamp,
        "metadata"     jsonb         NOT NULL DEFAULT '{}',
        "created_at"   timestamp     NOT NULL DEFAULT now(),
        "updated_at"   timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assets" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ASSET_EXT"
        ON "assets" ("external_id") WHERE "external_id" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS "IDX_ASSET_STATUS"
        ON "assets" ("status", "category");

      CREATE TABLE IF NOT EXISTS "sla_configs" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "name"         varchar       NOT NULL,
        "metric"       varchar       NOT NULL,
        "target_value" decimal(10,2) NOT NULL,
        "warning_pct"  integer       NOT NULL DEFAULT 80,
        "is_active"    boolean       NOT NULL DEFAULT true,
        "created_at"   timestamp     NOT NULL DEFAULT now(),
        "updated_at"   timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sla_configs" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_SLA_CONFIGS_ACTIVE"
        ON "sla_configs" ("is_active", "metric");

    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "sla_configs";
      DROP TABLE IF EXISTS "assets";
      DROP TABLE IF EXISTS "employees";
    `);
  }
}
