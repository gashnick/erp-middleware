import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { KpiSnapshot } from './analytics.types';
import { AnalyticsRepository } from './analytics.repository';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { getTenantContext } from '@common/context/tenant-context';

const CACHE_TTL_SECONDS = 300; // 5 minutes — short TTL so new data shows up quickly

@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);

  constructor(
    @Optional() @InjectRedis() private readonly redis: Redis,
    private readonly repo: AnalyticsRepository,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  private getActiveTenantId(): string {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new Error('Tenant context is required');
    return ctx.tenantId;
  }

  private cacheKey(tenantId: string): string {
    return `kpi:${tenantId}:${new Date().toISOString().slice(0, 10)}`;
  }

  async getSnapshot(): Promise<KpiSnapshot> {
    const tenantId = this.getActiveTenantId();

    if (this.redis) {
      const cached = await this.redis.get(this.cacheKey(tenantId));
      if (cached) return JSON.parse(cached) as KpiSnapshot;
    }

    return this.buildAndCache();
  }

  async buildAndCache(): Promise<KpiSnapshot> {
    const tenantId = this.getActiveTenantId();
    const now = new Date();
    const currentYear = now.getFullYear();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);

    const [
      revenueCurrentYear,
      revenuePreviousYear,
      expenseBreakdownLast90Days,
      cashPosition,
      invoiceCashPosition,
    ] = await Promise.all([
      this.repo.getRevenueByMonth(currentYear),
      this.repo.getRevenueByMonth(currentYear - 1),
      this.repo.getExpenseBreakdown(ninetyDaysAgo, now).catch(() => []), // expenses table may be empty
      this.repo.getCashPosition(now).catch(() => null), // bank_transactions may be empty
      this.getInvoiceCashPosition(), // fallback from invoices
    ]);

    // Merge both years — current year first, then previous year entries tagged with year
    const allRevenue = [...revenueCurrentYear, ...revenuePreviousYear];

    // Use bank_transactions cash position if available, else derive from invoices
    const resolvedCashPosition = cashPosition ?? invoiceCashPosition;

    const snapshot: KpiSnapshot = {
      tenantId,
      generatedAt: now,
      revenueCurrentYear: allRevenue,
      expenseBreakdownLast90Days,
      cashPosition: resolvedCashPosition ?? { balance: 0, currency: 'USD', asOf: now },
    };

    if (this.redis) {
      await this.redis.setex(this.cacheKey(tenantId), CACHE_TTL_SECONDS, JSON.stringify(snapshot));
      this.logger.log(`KPI snapshot cached for tenant ${tenantId}`);
    }

    return snapshot;
  }

  // Derives cash position from invoices when bank_transactions table is empty
  private async getInvoiceCashPosition(): Promise<{
    balance: number;
    currency: string;
    asOf: Date;
  } | null> {
    try {
      const rows = await this.tenantDb.executeTenant<{ balance: number; currency: string }>(
        `SELECT
          SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) -
          SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END) AS balance,
          currency
         FROM invoices
         WHERE currency IS NOT NULL
         GROUP BY currency
         ORDER BY balance DESC
         LIMIT 1`,
      );
      if (!rows[0]) return null;
      return { balance: Number(rows[0].balance), currency: rows[0].currency, asOf: new Date() };
    } catch {
      return null;
    }
  }

  async invalidate(): Promise<void> {
    const tenantId = this.getActiveTenantId();
    if (this.redis) await this.redis.del(this.cacheKey(tenantId));
  }
}
