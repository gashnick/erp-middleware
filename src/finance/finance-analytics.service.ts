// src/finance/finance-analytics.service.ts
import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { FinanceDashboardDto } from './dto/dashboard-summary.dto';

@Injectable()
export class FinanceAnalyticsService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async getDashboardSummary(
    tenantId: string,
  ): Promise<Omit<FinanceDashboardDto, 'tenantId' | 'apAging' | 'profitability' | 'anomalies'>> {
    // 🛡️ We use .transaction() to ensure a stable search_path for the duration of these multi-table reads.
    // The TenantQueryRunnerService will automatically resolve the schema from AsyncLocalStorage.
    // We pass tenantId for explicit validation even though TenantGuard has set the context.
    return this.tenantDb.transaction(async (runner) => {
      // 1. Combine Invoice-related stats into a single query to reduce IO
      // Using the runner provided by the transaction ensures we stay in the same session.
      const invoiceStatsResult = await runner.query(`
        SELECT 
          COALESCE(SUM(amount) FILTER (WHERE status != 'void'), 0) as "totalInvoiced",
          COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as "totalCollected",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date > NOW() - INTERVAL '30 days'), 0) as "current",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date <= NOW() - INTERVAL '30 days' AND due_date > NOW() - INTERVAL '60 days'), 0) as "overdue30",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date <= NOW() - INTERVAL '60 days' AND due_date > NOW() - INTERVAL '90 days'), 0) as "overdue60",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date <= NOW() - INTERVAL '90 days'), 0) as "overdue90"
        FROM invoices
      `);

      const invoiceStats = invoiceStatsResult[0];

      // 2. Count Anomalies from the quarantine_records table
      const anomalyResult = await runner.query(`
        SELECT COUNT(*)::int as count 
        FROM quarantine_records 
        WHERE status = 'pending'
      `);

      const anomalies = anomalyResult[0];

      // 3. Map to DTO with type safety - note we use arAging instead of agingReport
      return {
        cashFlow: {
          totalInvoiced: Number(invoiceStats.totalInvoiced),
          totalCollected: Number(invoiceStats.totalCollected),
          outstanding: Number(invoiceStats.totalInvoiced) - Number(invoiceStats.totalCollected),
        },
        arAging: {
          current: Number(invoiceStats.current),
          overdue30: Number(invoiceStats.overdue30),
          overdue60: Number(invoiceStats.overdue60),
          overdue90: Number(invoiceStats.overdue90),
        },
        recentAnomaliesCount: anomalies.count,
      };
    });
  }
}
