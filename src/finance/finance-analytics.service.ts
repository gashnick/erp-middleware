import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { FinanceDashboardDto } from './dto/dashboard-summary.dto';

@Injectable()
export class FinanceAnalyticsService {
  constructor(private readonly queryRunner: TenantQueryRunnerService) {}

  async getDashboardSummary(): Promise<FinanceDashboardDto> {
    return this.queryRunner.runInTenantContext(async (manager) => {
      // 1. Combine Invoice-related stats into a single query to reduce IO
      const [invoiceStats] = await manager.query(`
        SELECT 
          COALESCE(SUM(amount) FILTER (WHERE status != 'void'), 0) as "totalInvoiced",
          COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as "totalCollected",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date > NOW() - INTERVAL '30 days'), 0) as "current",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date <= NOW() - INTERVAL '30 days' AND due_date > NOW() - INTERVAL '60 days'), 0) as "overdue30",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date <= NOW() - INTERVAL '60 days' AND due_date > NOW() - INTERVAL '90 days'), 0) as "overdue60",
          COALESCE(SUM(amount) FILTER (WHERE status = 'pending' AND due_date <= NOW() - INTERVAL '90 days'), 0) as "overdue90"
        FROM invoices
      `);

      // 2. Count Anomalies (Separate table, keep separate or use a CTE)
      const [anomalies] = await manager.query(`
        SELECT COUNT(*)::int as count FROM quarantine_records WHERE status = 'pending'
      `);

      return {
        cashFlow: {
          totalInvoiced: Number(invoiceStats.totalInvoiced),
          totalCollected: Number(invoiceStats.totalCollected),
          outstanding: Number(invoiceStats.totalInvoiced) - Number(invoiceStats.totalCollected),
        },
        agingReport: {
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
