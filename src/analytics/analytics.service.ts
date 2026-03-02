import { Injectable } from '@nestjs/common';
import { AnalyticsCacheService } from './analytics-cache.service';
import { AnalyticsRepository } from './analytics.repository';
import { MonthlyRevenue, ExpenseCategory, CashPosition } from './analytics.types';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly cache: AnalyticsCacheService,
    private readonly repo: AnalyticsRepository,
  ) {}

  /**
   * Returns revenue trends. If the year is current, it attempts to
   * serve from the tenant-scoped cache snapshot.
   */
  async getRevenueByMonth(year: number): Promise<MonthlyRevenue[]> {
    // tenantId removed from parameters.
    // getSnapshot() and repo methods now pull from AsyncLocalStorage context.
    if (year === new Date().getFullYear()) {
      const snapshot = await this.cache.getSnapshot();
      return snapshot.revenueCurrentYear;
    }

    return this.repo.getRevenueByMonth(year);
  }

  /**
   * Fetches expense categories for the active tenant context.
   */
  async getExpenseBreakdown(from: Date, to: Date): Promise<ExpenseCategory[]> {
    return this.repo.getExpenseBreakdown(from, to);
  }

  /**
   * Fetches the latest cash position for the active tenant context.
   */
  async getCashPosition(asOf?: Date): Promise<CashPosition | null> {
    return this.repo.getCashPosition(asOf);
  }
}
