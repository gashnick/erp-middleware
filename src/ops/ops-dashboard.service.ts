// src/ops/ops-dashboard.service.ts
//
// Single-responsibility service for all Operations Dashboard queries.
//
// Methods:
//   inventorySummary()  — asset counts by status + category with avg uptime
//   assetStatus()       — paginated asset list with optional filters
//   ordersPipeline()    — orders grouped by status and channel
//   slaStatus()         — all active SLA configs with current actual vs target
//   slaBreaches()       — subset of slaStatus() where state = 'breached'
//   createSlaConfig()   — insert a new SLA rule
//   slaBreachCount()    — used by AlertEvaluatorService for 'sla_breach' metric
//
// Design rules:
//   - All SQL uses $1/$2 parameterized queries — no string interpolation
//   - tenantDb.executeTenant() relies on AsyncLocalStorage schema context
//   - Feature flag checked in controller, not here
//   - slaStatus() computes actual values inline from existing tenant tables;
//     no separate metrics store needed for Phase 1

import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import {
  Asset,
  AssetFilters,
  AssetStatus,
  InventorySummary,
  OrdersPipeline,
  SlaConfig,
  SlaStatusItem,
  SlaStatusResult,
  CreateSlaConfigDto,
} from './ops.types';

@Injectable()
export class OpsDashboardService {
  private readonly logger = new Logger(OpsDashboardService.name);

  // ── SQL ───────────────────────────────────────────────────────────────────

  private static readonly INVENTORY_SUMMARY_SQL = `
    SELECT
      COUNT(*)::int                                                   AS total,
      COUNT(*) FILTER (WHERE status = 'operational')::int            AS operational,
      COUNT(*) FILTER (WHERE status = 'maintenance')::int            AS maintenance,
      COUNT(*) FILTER (WHERE status = 'offline')::int                AS offline,
      COUNT(*) FILTER (WHERE status = 'retired')::int                AS retired
    FROM assets
  `;

  private static readonly INVENTORY_BY_CATEGORY_SQL = `
    SELECT
      category,
      COUNT(*)::int                                                   AS total,
      COUNT(*) FILTER (WHERE status = 'operational')::int            AS operational,
      ROUND(AVG(uptime_pct)::numeric, 2)                             AS avg_uptime_pct
    FROM assets
    GROUP BY category
    ORDER BY total DESC
  `;

  private static readonly ASSET_LIST_SQL = `
    SELECT
      id,
      external_id    AS "externalId",
      name,
      category,
      status,
      uptime_pct     AS "uptimePct",
      last_service   AS "lastService",
      next_service   AS "nextService",
      metadata,
      created_at     AS "createdAt",
      updated_at     AS "updatedAt"
    FROM assets
    WHERE ($1::varchar IS NULL OR category = $1)
      AND ($2::varchar IS NULL OR status   = $2)
    ORDER BY
      CASE status
        WHEN 'offline'     THEN 1
        WHEN 'maintenance' THEN 2
        WHEN 'operational' THEN 3
        WHEN 'retired'     THEN 4
      END ASC,
      next_service ASC NULLS LAST,
      name ASC
    LIMIT  $3
    OFFSET $4
  `;

  /**
   * Orders pipeline — grouped by status then by channel.
   * orders.status is a free varchar with no CHECK constraint, so we group
   * on whatever values exist rather than filtering to a fixed enum.
   */
  private static readonly ORDERS_BY_STATUS_SQL = `
    SELECT
      status,
      COUNT(*)::int          AS count,
      SUM(amount)::decimal   AS total_value,
      AVG(amount)::decimal   AS avg_value
    FROM orders
    GROUP BY status
    ORDER BY total_value DESC
  `;

  private static readonly ORDERS_BY_CHANNEL_SQL = `
    SELECT
      channel,
      COUNT(*)::int          AS count,
      SUM(amount)::decimal   AS total_value
    FROM orders
    GROUP BY channel
    ORDER BY total_value DESC
  `;

  private static readonly ORDERS_TOTALS_SQL = `
    SELECT
      COUNT(*)::int        AS total_orders,
      SUM(amount)::decimal AS total_value
    FROM orders
  `;

  /** All active SLA configs — joined with live metric values below in code */
  private static readonly SLA_CONFIGS_SQL = `
    SELECT
      id,
      name,
      metric,
      target_value  AS "targetValue",
      warning_pct   AS "warningPct",
      is_active     AS "isActive",
      created_at    AS "createdAt",
      updated_at    AS "updatedAt"
    FROM sla_configs
    WHERE is_active = true
    ORDER BY name ASC
  `;

  private static readonly INSERT_SLA_CONFIG_SQL = `
    INSERT INTO sla_configs (name, metric, target_value, warning_pct)
    VALUES ($1, $2, $3, $4)
    RETURNING
      id, name, metric,
      target_value AS "targetValue",
      warning_pct  AS "warningPct",
      is_active    AS "isActive",
      created_at   AS "createdAt",
      updated_at   AS "updatedAt"
  `;

  // ── Metric resolvers — one per supported SLA metric ───────────────────────

  /**
   * Average invoice processing time in hours (created → paid).
   * Used by SLA configs with metric = 'invoice_processing_hours'.
   */
  private static readonly METRIC_INVOICE_PROCESSING_SQL = `
    SELECT
      AVG(
        EXTRACT(EPOCH FROM (updated_at - invoice_date)) / 3600
      )::decimal AS value
    FROM invoices
    WHERE status = 'paid'
      AND invoice_date IS NOT NULL
      AND created_at >= NOW() - INTERVAL '30 days'
  `;

  /**
   * Overdue invoice count.
   * Used by SLA configs with metric = 'overdue_invoice_count'.
   */
  private static readonly METRIC_OVERDUE_INVOICES_SQL = `
    SELECT COUNT(*)::int AS value
    FROM invoices
    WHERE status = 'overdue'
  `;

  /**
   * Count of orders NOT in a terminal state (pending/processing/in_progress).
   * Approximates "orders in progress" SLA.
   * Used by SLA configs with metric = 'orders_in_progress'.
   */
  private static readonly METRIC_ORDERS_IN_PROGRESS_SQL = `
    SELECT COUNT(*)::int AS value
    FROM orders
    WHERE status NOT IN ('completed', 'delivered', 'cancelled', 'refunded')
  `;

  /**
   * Average asset uptime across all operational + maintenance assets.
   * Used by SLA configs with metric = 'avg_asset_uptime_pct'.
   */
  private static readonly METRIC_AVG_UPTIME_SQL = `
    SELECT ROUND(AVG(uptime_pct)::numeric, 2) AS value
    FROM assets
    WHERE status IN ('operational', 'maintenance')
      AND uptime_pct IS NOT NULL
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Asset inventory snapshot — totals by status and breakdown by category.
   */
  async inventorySummary(): Promise<InventorySummary> {
    const [summaryRows, categoryRows] = await Promise.all([
      this.tenantDb.executeTenant<{
        total: number;
        operational: number;
        maintenance: number;
        offline: number;
        retired: number;
      }>(OpsDashboardService.INVENTORY_SUMMARY_SQL),
      this.tenantDb.executeTenant<{
        category: string;
        total: number;
        operational: number;
        avg_uptime_pct: string | null;
      }>(OpsDashboardService.INVENTORY_BY_CATEGORY_SQL),
    ]);

    const s = summaryRows[0] ?? {};
    return {
      total: Number(s.total ?? 0),
      operational: Number(s.operational ?? 0),
      maintenance: Number(s.maintenance ?? 0),
      offline: Number(s.offline ?? 0),
      retired: Number(s.retired ?? 0),
      byCategory: categoryRows.map((r) => ({
        category: r.category,
        total: Number(r.total ?? 0),
        operational: Number(r.operational ?? 0),
        avgUptimePct: r.avg_uptime_pct != null ? parseFloat(r.avg_uptime_pct) : null,
      })),
    };
  }

  /**
   * Paginated asset list.
   * Default sort: offline first → maintenance → operational → retired,
   * then by next_service date ascending (most overdue first).
   */
  async assetStatus(filters: AssetFilters = {}): Promise<Asset[]> {
    const { category = null, status = null, limit = 50, offset = 0 } = filters;

    const rows = await this.tenantDb.executeTenant<{
      id: string;
      externalId: string | null;
      name: string;
      category: string;
      status: string;
      uptimePct: string | null;
      lastService: string | null;
      nextService: string | null;
      metadata: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>(OpsDashboardService.ASSET_LIST_SQL, [category, status, limit, offset]);

    return rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      name: r.name,
      category: r.category,
      status: r.status as AssetStatus,
      uptimePct: r.uptimePct != null ? parseFloat(r.uptimePct) : null,
      lastService: r.lastService,
      nextService: r.nextService,
      metadata: r.metadata ?? {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Orders pipeline — count and value grouped by status and channel.
   * Does not filter by date range: shows all-time pipeline state.
   * Extend with from/to params in Stream 5 when reports need date slicing.
   */
  async ordersPipeline(): Promise<OrdersPipeline> {
    const [statusRows, channelRows, totalRows] = await Promise.all([
      this.tenantDb.executeTenant<{
        status: string;
        count: number;
        total_value: string;
        avg_value: string;
      }>(OpsDashboardService.ORDERS_BY_STATUS_SQL),
      this.tenantDb.executeTenant<{
        channel: string;
        count: number;
        total_value: string;
      }>(OpsDashboardService.ORDERS_BY_CHANNEL_SQL),
      this.tenantDb.executeTenant<{
        total_orders: number;
        total_value: string;
      }>(OpsDashboardService.ORDERS_TOTALS_SQL),
    ]);

    const t = totalRows[0] ?? {};
    return {
      totalOrders: Number(t.total_orders ?? 0),
      totalValue: parseFloat(t.total_value ?? '0'),
      byStatus: statusRows.map((r) => ({
        status: r.status,
        count: Number(r.count ?? 0),
        totalValue: parseFloat(r.total_value ?? '0'),
        avgValue: parseFloat(r.avg_value ?? '0'),
      })),
      byChannel: channelRows.map((r) => ({
        channel: r.channel,
        count: Number(r.count ?? 0),
        totalValue: parseFloat(r.total_value ?? '0'),
      })),
    };
  }

  /**
   * SLA status — all active configs with current actual value vs target.
   *
   * Actual values are resolved per metric via dedicated SQL queries.
   * Metrics not yet supported return null (no data) rather than crashing.
   *
   * State logic:
   *   breached → actual > target
   *   warning  → actual > target * (warningPct / 100)
   *   ok       → everything else
   */
  async slaStatus(): Promise<SlaStatusResult> {
    const configs = await this.tenantDb.executeTenant<SlaConfig>(
      OpsDashboardService.SLA_CONFIGS_SQL,
    );

    const items: SlaStatusItem[] = await Promise.all(
      configs.map(async (config) => {
        const actualValue = await this.resolveMetric(config.metric);
        const usedPct =
          actualValue != null && config.targetValue > 0
            ? parseFloat(((actualValue / config.targetValue) * 100).toFixed(2))
            : null;

        const state = this.computeState(actualValue, config.targetValue, config.warningPct);

        return { ...config, actualValue, usedPct, state };
      }),
    );

    return {
      asOf: new Date().toISOString(),
      total: items.length,
      ok: items.filter((i) => i.state === 'ok').length,
      warning: items.filter((i) => i.state === 'warning').length,
      breached: items.filter((i) => i.state === 'breached').length,
      items,
    };
  }

  /**
   * SLA breaches only — convenience endpoint for alert badges and dashboards.
   */
  async slaBreaches(): Promise<SlaStatusItem[]> {
    const { items } = await this.slaStatus();
    return items.filter((i) => i.state === 'breached');
  }

  /**
   * Returns the count of currently breached SLAs.
   * Called by AlertEvaluatorService for the 'sla_breach' alert metric.
   * Kept deliberately lightweight — no full status computation.
   */
  async slaBreachCount(): Promise<number> {
    const breaches = await this.slaBreaches();
    return breaches.length;
  }

  /**
   * Creates a new SLA config rule for this tenant.
   */
  async createSlaConfig(dto: CreateSlaConfigDto): Promise<SlaConfig> {
    const rows = await this.tenantDb.executeTenant<SlaConfig>(
      OpsDashboardService.INSERT_SLA_CONFIG_SQL,
      [dto.name, dto.metric, dto.targetValue, dto.warningPct ?? 80],
    );
    return rows[0];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Resolves the current actual value for a named SLA metric.
   * Returns null if the metric is unknown or has no data yet.
   * Fails open — a metric fetch error never crashes the whole slaStatus() call.
   */
  private async resolveMetric(metric: string): Promise<number | null> {
    try {
      let sql: string | null = null;

      switch (metric) {
        case 'invoice_processing_hours':
          sql = OpsDashboardService.METRIC_INVOICE_PROCESSING_SQL;
          break;
        case 'overdue_invoice_count':
          sql = OpsDashboardService.METRIC_OVERDUE_INVOICES_SQL;
          break;
        case 'orders_in_progress':
          sql = OpsDashboardService.METRIC_ORDERS_IN_PROGRESS_SQL;
          break;
        case 'avg_asset_uptime_pct':
          sql = OpsDashboardService.METRIC_AVG_UPTIME_SQL;
          break;
        default:
          this.logger.warn(`Unknown SLA metric: '${metric}' — returning null`);
          return null;
      }

      const rows = await this.tenantDb.executeTenant<{ value: string | null }>(sql);
      const raw = rows[0]?.value;
      return raw != null ? parseFloat(raw) : null;
    } catch (err) {
      this.logger.warn(`Failed to resolve SLA metric '${metric}': ${err.message}`);
      return null;
    }
  }

  /**
   * Determines SLA state from actual value, target, and warning threshold.
   *
   * For metrics where lower is better (processing time, overdue count):
   *   breached → actual > target
   *   warning  → actual > target * (warningPct / 100)
   *
   * Note: uptime metrics (higher = better) will invert naturally because
   * the SLA target IS the minimum — actual < target means breached.
   * Callers should set target to the minimum acceptable value.
   */
  private computeState(
    actual: number | null,
    target: number,
    warningPct: number,
  ): 'ok' | 'warning' | 'breached' {
    if (actual == null) return 'ok'; // no data → not breached
    if (actual > target) return 'breached';
    if (actual > target * (warningPct / 100)) return 'warning';
    return 'ok';
  }
}
