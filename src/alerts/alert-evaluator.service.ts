// src/alerts/alert-evaluator.service.ts
//
// Runs every 5 minutes via Bull queue, evaluates all active alert rules
// against live tenant data, and triggers alert events when thresholds are breached.
//
// Per-metric evaluators:
//   cash_balance          — SUM(credits) - SUM(debits) from bank_transactions
//   expense_spike         — checks anomalies table for recent EXPENSE_SPIKE entries
//   overdue_invoice_count — COUNT of overdue invoices
//   unusual_payment       — checks anomalies table for recent UNUSUAL_PAYMENT entries
//   sla_breach            — count of breached SLA configs (via OpsDashboardService)
//
// Deduplication:
//   An alert event is only created if no 'open' event exists for the same rule.
//   This prevents the evaluator from flooding the events table on every 5-minute run.

import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AlertRule, AlertEvent, AlertMetric } from './alert.types';
import { OpsDashboardService } from '@ops/ops-dashboard.service';

@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  // ── SQL ───────────────────────────────────────────────────────────────────

  private static readonly GET_ACTIVE_RULES_SQL = `
    SELECT
      id, name, metric, operator, threshold, severity, channels,
      is_active AS "isActive", created_by AS "createdBy"
    FROM alert_rules
    WHERE is_active = true
    ORDER BY severity DESC, created_at ASC
  `;

  private static readonly CHECK_OPEN_EVENT_SQL = `
    SELECT id FROM alert_events
    WHERE rule_id = $1 AND status = 'open'
    LIMIT 1
  `;

  private static readonly INSERT_EVENT_SQL = `
    INSERT INTO alert_events (rule_id, metric, actual_value, threshold, severity, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    RETURNING
      id, rule_id AS "ruleId", metric, actual_value AS "actualValue",
      threshold, severity, status, metadata, triggered_at AS "triggeredAt"
  `;

  private static readonly CASH_BALANCE_SQL = `
    SELECT
      COALESCE(
        SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END),
        0
      ) AS balance
    FROM bank_transactions
  `;

  private static readonly OVERDUE_COUNT_SQL = `
    SELECT COUNT(*)::int AS count
    FROM invoices
    WHERE status = 'overdue'
  `;

  private static readonly RECENT_ANOMALY_SQL = `
    SELECT COUNT(*)::int AS count
    FROM anomalies
    WHERE type = $1
      AND detected_at >= NOW() - INTERVAL '24 hours'
      AND score >= 0.7
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    @InjectQueue('alert-evaluation') private readonly alertQueue: Queue,
    private readonly opsDashboard: OpsDashboardService,
  ) {}

  /**
   * Enqueues evaluation jobs for all tenants.
   * Called by AlertSchedulerService every 5 minutes.
   */
  async enqueueForAllTenants(): Promise<void> {
    const tenants = await this.tenantDb.executePublic<{ id: string; schemaName: string }>(
      `SELECT id, schema_name AS "schemaName"
       FROM public.tenants
       WHERE status = 'active'`,
    );

    for (const tenant of tenants) {
      await this.alertQueue.add(
        'evaluate',
        { tenantId: tenant.id, schemaName: tenant.schemaName },
        { attempts: 2, backoff: 5000, removeOnComplete: true },
      );
    }

    this.logger.debug(`Enqueued alert evaluation for ${tenants.length} tenants`);
  }

  /**
   * Evaluates all active alert rules for a single tenant.
   * Called by the Bull job processor.
   */
  async evaluateForTenant(tenantId: string, schemaName: string): Promise<void> {
    const rules = await this.tenantDb.executeTenant<AlertRule>(
      AlertEvaluatorService.GET_ACTIVE_RULES_SQL,
    );

    if (rules.length === 0) return;

    this.logger.debug(`Evaluating ${rules.length} rules for tenant ${tenantId}`);

    for (const rule of rules) {
      try {
        await this.evaluateRule(rule, tenantId);
      } catch (err) {
        // One failed rule never blocks the rest
        this.logger.error(`Rule evaluation failed [${rule.id}]: ${err.message}`);
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async evaluateRule(rule: AlertRule, tenantId: string): Promise<void> {
    const actualValue = await this.fetchMetricValue(rule.metric);

    if (actualValue === null) return; // metric unavailable — skip

    const breached = this.isBreached(actualValue, rule.operator, Number(rule.threshold));
    if (!breached) return;

    // Deduplication — don't fire if an open event already exists for this rule
    const existing = await this.tenantDb.executeTenant(AlertEvaluatorService.CHECK_OPEN_EVENT_SQL, [
      rule.id,
    ]);
    if (existing[0]) {
      this.logger.debug(`Rule ${rule.id} already has an open event — skipping`);
      return;
    }

    // Create the alert event
    await this.tenantDb.executeTenant<AlertEvent>(AlertEvaluatorService.INSERT_EVENT_SQL, [
      rule.id,
      rule.metric,
      actualValue,
      rule.threshold,
      rule.severity,
      JSON.stringify({
        ruleName: rule.name,
        tenantId,
        evaluatedAt: new Date().toISOString(),
      }),
    ]);

    this.logger.log(
      `Alert triggered: "${rule.name}" [${rule.metric} ${rule.operator} ${rule.threshold}] ` +
        `actual=${actualValue} severity=${rule.severity}`,
    );

    // Enqueue notification job (handled by AlertNotifierProcessor)
    await this.alertQueue.add('notify', {
      ruleId: rule.id,
      ruleName: rule.name,
      metric: rule.metric,
      actualValue,
      threshold: rule.threshold,
      severity: rule.severity,
      channels: rule.channels,
      tenantId,
    });
  }

  private async fetchMetricValue(metric: AlertMetric): Promise<number | null> {
    try {
      switch (metric) {
        case 'cash_balance': {
          const rows = await this.tenantDb.executeTenant<{ balance: string }>(
            AlertEvaluatorService.CASH_BALANCE_SQL,
          );
          return Number(rows[0]?.balance ?? 0);
        }
        case 'overdue_invoice_count': {
          const rows = await this.tenantDb.executeTenant<{ count: number }>(
            AlertEvaluatorService.OVERDUE_COUNT_SQL,
          );
          return Number(rows[0]?.count ?? 0);
        }
        case 'expense_spike': {
          const rows = await this.tenantDb.executeTenant<{ count: number }>(
            AlertEvaluatorService.RECENT_ANOMALY_SQL,
            ['EXPENSE_SPIKE'],
          );
          return Number(rows[0]?.count ?? 0);
        }
        case 'unusual_payment': {
          const rows = await this.tenantDb.executeTenant<{ count: number }>(
            AlertEvaluatorService.RECENT_ANOMALY_SQL,
            ['UNUSUAL_PAYMENT'],
          );
          return Number(rows[0]?.count ?? 0);
        }
        case 'sla_breach':
          return this.opsDashboard.slaBreachCount();
        default:
          return null;
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch metric '${metric}': ${err.message}`);
      return null;
    }
  }

  private isBreached(actual: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'lt':
        return actual < threshold;
      case 'lte':
        return actual <= threshold;
      case 'gt':
        return actual > threshold;
      case 'gte':
        return actual >= threshold;
      case 'eq':
        return actual === threshold;
      default:
        return false;
    }
  }
}
