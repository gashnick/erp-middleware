// src/database/migrations/tenant/17050000000013-AlertsEngine.ts
//
// Creates alert_rules and alert_events tables in each tenant schema.
//
// alert_rules  — user-defined thresholds ("cash < 10000 → critical → email")
// alert_events — fired instances when a rule's threshold is breached
//
// Both tables live in the tenant schema (not public) so each tenant's
// rules and events are fully isolated from other tenants.

export class AlertsEngine17050000000013 {
  public async up(queryRunner: any): Promise<void> {
    await queryRunner.query(`

      CREATE TABLE IF NOT EXISTS "alert_rules" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "name"        varchar       NOT NULL,
        "metric"      varchar       NOT NULL
          CHECK ("metric" IN (
            'cash_balance',
            'expense_spike',
            'overdue_invoice_count',
            'unusual_payment',
            'sla_breach'
          )),
        "operator"    varchar       NOT NULL
          CHECK ("operator" IN ('lt', 'gt', 'lte', 'gte', 'eq')),
        "threshold"   decimal(15,2) NOT NULL,
        "severity"    varchar       NOT NULL
          CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
        "channels"    text[]        NOT NULL DEFAULT '{}',
        "is_active"   boolean       NOT NULL DEFAULT true,
        "created_by"  uuid          NOT NULL,
        "created_at"  timestamp     NOT NULL DEFAULT now(),
        "updated_at"  timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_alert_rules" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_ALERT_RULES_ACTIVE"
        ON "alert_rules" ("is_active", "metric");

      CREATE TABLE IF NOT EXISTS "alert_events" (
        "id"               uuid          NOT NULL DEFAULT gen_random_uuid(),
        "rule_id"          uuid          NOT NULL,
        "metric"           varchar       NOT NULL,
        "actual_value"     decimal(15,2) NOT NULL,
        "threshold"        decimal(15,2) NOT NULL,
        "severity"         varchar       NOT NULL,
        "status"           varchar       NOT NULL DEFAULT 'open'
          CHECK ("status" IN ('open', 'acknowledged', 'resolved')),
        "acknowledged_by"  uuid,
        "acknowledged_at"  timestamp,
        "resolved_at"      timestamp,
        "metadata"         jsonb         NOT NULL DEFAULT '{}',
        "triggered_at"     timestamp     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_alert_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_alert_event_rule"
          FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS "IDX_ALERT_EVENTS_STATUS"
        ON "alert_events" ("status", "severity", "triggered_at" DESC);
      CREATE INDEX IF NOT EXISTS "IDX_ALERT_EVENTS_RULE"
        ON "alert_events" ("rule_id", "triggered_at" DESC);

    `);
  }

  public async down(queryRunner: any): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "alert_events";
      DROP TABLE IF EXISTS "alert_rules";
    `);
  }
}
