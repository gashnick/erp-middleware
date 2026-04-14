// src/database/migrations/tenant/1705000000009-ReportsAndExports.ts
//
// Adds scheduled reporting and secure export tables to each tenant schema.
//
// report_schedules — one row per configured recurring report.
//   Stores only cron expression + timezone; the scheduler computes next_run_at.
//   Simple interval selections (daily/weekly/monthly) are converted to cron
//   strings by CronHelperService before being stored here.
//
// export_logs — one row per secure download link created.
//   secure_token is a UUID used as a one-time-style download key.
//   accessed_at is NULL until the link is first accessed.
//   Links expire after 24 hours (checked at download time, not by a cleanup job).

export class ReportsAndExports1705000000009 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`

      -- ── Scheduled reports ──────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "report_schedules" (
        "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
        "name"         varchar     NOT NULL,
        "cron"         varchar     NOT NULL,
        "timezone"     varchar     NOT NULL DEFAULT 'UTC',
        "format"       varchar     NOT NULL DEFAULT 'pdf'
          CHECK ("format" IN ('pdf', 'csv', 'xlsx')),
        "recipients"   text[]      NOT NULL DEFAULT '{}',
        "sections"     text[]      NOT NULL DEFAULT '{finance,hr,ops}',
        "is_active"    boolean     NOT NULL DEFAULT true,
        "last_run_at"  timestamp,
        "next_run_at"  timestamp,
        "created_by"   uuid        NOT NULL,
        "created_at"   timestamp   NOT NULL DEFAULT now(),
        "updated_at"   timestamp   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_schedules" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_REPORT_SCHEDULES_NEXT_RUN"
        ON "report_schedules" ("next_run_at")
        WHERE "is_active" = true;
      CREATE INDEX IF NOT EXISTS "IDX_REPORT_SCHEDULES_ACTIVE"
        ON "report_schedules" ("is_active", "next_run_at");

      -- ── Export logs ─────────────────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS "export_logs" (
        "id"             uuid        NOT NULL DEFAULT gen_random_uuid(),
        "secure_token"   uuid        NOT NULL DEFAULT gen_random_uuid(),
        "report_name"    varchar     NOT NULL,
        "format"         varchar     NOT NULL
          CHECK ("format" IN ('pdf', 'csv', 'xlsx')),
        "file_size"      integer,
        "expires_at"     timestamp   NOT NULL,
        "accessed_at"    timestamp,
        "accessed_by_ip" varchar,
        "created_by"     uuid        NOT NULL,
        "created_at"     timestamp   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_export_logs" PRIMARY KEY ("id")
      );

      -- Token lookups must be fast — every download request hits this index
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_EXPORT_TOKEN"
        ON "export_logs" ("secure_token");
      CREATE INDEX IF NOT EXISTS "IDX_EXPORT_LOGS_EXPIRES"
        ON "export_logs" ("expires_at");
      CREATE INDEX IF NOT EXISTS "IDX_EXPORT_LOGS_CREATED_BY"
        ON "export_logs" ("created_by", "created_at" DESC);

    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "export_logs";
      DROP TABLE IF EXISTS "report_schedules";
    `);
  }
}
