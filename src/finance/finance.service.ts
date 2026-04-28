// src/finance/finance.service.ts
import { Injectable } from '@nestjs/common';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceDashboardDto } from './dto/dashboard-summary.dto';

@Injectable()
export class FinanceService {
  constructor(private readonly analytics: FinanceAnalyticsService) {}

  // Existing
  async getDashboardStats(tenantId: string): Promise<FinanceDashboardDto> {
    const summary = await this.analytics.getDashboardSummary(tenantId);
    return {
      tenantId,
      cashFlow: summary.cashFlow,
      arAging: summary.arAging,
      apAging: { current: 0, overdue30: 0, overdue60: 0, overdue90: 0 },
      profitability: { grossMargin: 0, netProfit: 0 },
      anomalies: [],
      recentAnomaliesCount: summary.recentAnomaliesCount,
    };
  }

  // NEW — Flat KPI shape for dashboard cards
  async getDashboardKpis(tenantId: string) {
    const summary = await this.analytics.getDashboardSummary(tenantId);
    return {
      cashBalance: {
        current: summary.cashFlow.totalCollected,
        currency: 'USD',
        changePercentage: 0,
        trend: 'neutral' as const,
        asOf: new Date().toISOString(),
      },
      totalRevenue: summary.cashFlow.totalInvoiced,
      totalExpenses: 0,
      pendingInvoicesCount: 0,
      overdueInvoicesCount: 0,
      revenueChangePercentage: 0,
    };
  }

  // NEW — Monthly revenue/expenses time series
  async getRevenueChart(tenantId: string, months: number) {
    return this.analytics.getRevenueByMonth(tenantId, months);
  }

  // NEW — Paginated invoices
  async getInvoices(tenantId: string, params: { page: number; limit: number; status?: string }) {
    return this.analytics.getInvoicesPaginated(tenantId, params);
  }

  async getCashBalance(tenantId: string) {
    return this.analytics.getCashBalance(tenantId);
  }

  async getCashFlow(tenantId: string, year: number) {
    return this.analytics.getCashFlow(tenantId, year);
  }

  async getRecentTransactions(tenantId: string, limit: number) {
    return this.analytics.getRecentTransactions(tenantId, limit);
  }

  async getExpensesBreakdown(tenantId: string, from: string, to: string) {
    return this.analytics.getExpensesBreakdown(tenantId, from, to);
  }

  async getInvoiceAging(tenantId: string) {
    return this.analytics.getInvoiceAging(tenantId);
  }
}
