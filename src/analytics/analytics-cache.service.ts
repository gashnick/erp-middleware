// src/analytics/analytics-cache.service.ts
//
// Responsibility: Redis caching layer for the KPI snapshot.
//
// What this service does:
//   • Checks Redis for a cached snapshot before hitting the DB
//   • Builds a fresh snapshot when cache is cold or expired
//   • Provides cache invalidation when new data is uploaded via ETL
//
// What this service does NOT do (moved to dynamic query engine):
//   • Format data for the LLM         → ResultFormatterService
//   • Classify user questions          → QueryIntentService
//   • Run targeted per-table queries   → DynamicQueryBuilderService

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { KpiSnapshot } from './analytics.types';
import { AnalyticsRepository } from './analytics.repository';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { getTenantContext } from '@common/context/tenant-context';

// Short TTL — new ETL uploads should reflect within 5 minutes without a manual flush
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);

  constructor(
    @Optional() @InjectRedis() private readonly redis: Redis,
    private readonly repo: AnalyticsRepository,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns a cached KPI snapshot if available, otherwise builds and caches one.
   * Used by DynamicDataFetcherService as the fallback for broad overview questions.
   */
  async getSnapshot(): Promise<KpiSnapshot> {
    const tenantId = this.getActiveTenantId();

    if (this.redis) {
      const cached = await this.redis.get(this.cacheKey(tenantId));
      if (cached) {
        this.logger.debug(`Cache hit for tenant ${tenantId}`);
        return JSON.parse(cached) as KpiSnapshot;
      }
    }

    return this.buildAndCache();
  }

  /**
   * Forces a fresh snapshot build and writes it to Redis.
   * Call this after ETL uploads to ensure the AI sees new data immediately.
   */
  async buildAndCache(): Promise<KpiSnapshot> {
    const tenantId = this.getActiveTenantId();
    const now = new Date();
    const currentYear = now.getFullYear();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);

    // Fetch all data in parallel — individual failures don't block others
    const [
      revenueCurrentYear,
      revenuePreviousYear,
      expenseBreakdownLast90Days,
      bankCashPosition,
      invoiceCashPosition,
    ] = await Promise.all([
      this.repo.getRevenueByMonth(currentYear).catch(() => []),
      this.repo.getRevenueByMonth(currentYear - 1).catch(() => []),
      this.repo.getExpenseBreakdown(ninetyDaysAgo, now).catch(() => []),
      this.repo.getCashPosition(now).catch(() => null),
      this.getInvoiceCashPosition(),
    ]);

    const snapshot: KpiSnapshot = {
      tenantId,
      generatedAt: now,
      revenueCurrentYear: [...revenueCurrentYear, ...revenuePreviousYear],
      expenseBreakdownLast90Days,
      // Bank transactions cash position takes priority; invoice-derived is the fallback
      cashPosition: bankCashPosition ??
        invoiceCashPosition ?? { balance: 0, currency: 'USD', asOf: now },
    };

    if (this.redis) {
      await this.redis.setex(this.cacheKey(tenantId), CACHE_TTL_SECONDS, JSON.stringify(snapshot));
      this.logger.log(`KPI snapshot cached for tenant ${tenantId}`);
    }

    return snapshot;
  }

  /**
   * Invalidates the cached snapshot for the current tenant.
   * Should be called by EtlService after a successful upload.
   */
  async invalidate(): Promise<void> {
    const tenantId = this.getActiveTenantId();
    if (this.redis) {
      await this.redis.del(this.cacheKey(tenantId));
      this.logger.log(`Cache invalidated for tenant ${tenantId}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private getActiveTenantId(): string {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new Error('Tenant context is required for cache operations');
    return ctx.tenantId;
  }

  private cacheKey(tenantId: string): string {
    return `kpi:${tenantId}:${new Date().toISOString().slice(0, 10)}`;
  }

  /**
   * Derives a cash position from invoices when bank_transactions is empty.
   * paid invoices contribute positively; overdue invoices reduce the balance.
   */
  private async getInvoiceCashPosition(): Promise<{
    balance: number;
    currency: string;
    asOf: Date;
  } | null> {
    try {
      const rows = await this.tenantDb.executeTenant<{ balance: string; currency: string }>(
        `SELECT
           SUM(CASE WHEN status = 'paid'    THEN amount ELSE 0 END) -
           SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END) AS balance,
           currency
         FROM invoices
         WHERE currency IS NOT NULL
         GROUP BY currency
         ORDER BY balance DESC
         LIMIT 1`,
      );
      if (!rows[0]) return null;
      return {
        balance: Number(rows[0].balance),
        currency: rows[0].currency,
        asOf: new Date(),
      };
    } catch {
      return null;
    }
  }
}
