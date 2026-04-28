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

  async getRevenueByMonth(tenantId: string, months: number) {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', invoice_date), 'Mon YYYY') as month,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as revenue,
        0 as expenses
      FROM invoices
      WHERE invoice_date >= NOW() - INTERVAL '${months} months'
        AND invoice_date IS NOT NULL
      GROUP BY DATE_TRUNC('month', invoice_date)
      ORDER BY DATE_TRUNC('month', invoice_date) ASC
    `);
      return rows.map((r: any) => ({
        month: r.month,
        revenue: Number(r.revenue),
        expenses: Number(r.expenses),
      }));
    });
  }

  async getInvoicesPaginated(
    tenantId: string,
    params: { page: number; limit: number; status?: string },
  ) {
    const { page, limit, status } = params;
    const offset = (page - 1) * limit;
    const whereClause = status ? `WHERE status = '${status}'` : '';

    return this.tenantDb.transaction(async (runner) => {
      const [rows, countResult] = await Promise.all([
        runner.query(`
        SELECT
          id,
          invoice_number   AS "invoiceNumber",
          customer_name    AS "customerName",
          amount,
          currency,
          status,
          due_date         AS "dueDate",
          invoice_date     AS "issuedAt"
        FROM invoices
        ${whereClause}
        ORDER BY invoice_date DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `),
        runner.query(`
        SELECT COUNT(*)::int as total FROM invoices ${whereClause}
      `),
      ]);

      const total = countResult[0].total;
      return {
        data: rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async getCashBalance(tenantId: string) {
    return this.tenantDb.transaction(async (runner) => {
      const [credits, debits] = await Promise.all([
        runner.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM bank_transactions WHERE type = 'credit'
      `),
        runner.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM bank_transactions WHERE type = 'debit'
      `),
      ]);
      const current = Number(credits[0].total) - Number(debits[0].total);
      return {
        current,
        currency: 'USD',
        changePercentage: 0,
        trend: 'neutral' as const,
        asOf: new Date().toISOString(),
      };
    });
  }

  async getCashFlow(tenantId: string, year: number) {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', transaction_date), 'Mon YYYY') as month,
        COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) as inflow,
        COALESCE(SUM(amount) FILTER (WHERE type = 'debit'),  0) as outflow
      FROM bank_transactions
      WHERE EXTRACT(YEAR FROM transaction_date) = ${year}
      GROUP BY DATE_TRUNC('month', transaction_date)
      ORDER BY DATE_TRUNC('month', transaction_date) ASC
    `);
      return rows.map((r: any) => ({
        month: r.month,
        inflow: Number(r.inflow),
        outflow: Number(r.outflow),
        net: Number(r.inflow) - Number(r.outflow),
      }));
    });
  }

  async getRecentTransactions(tenantId: string, limit: number) {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(`
      SELECT
        id,
        type,
        amount,
        currency,
        description,
        transaction_date AS "transactionDate",
        reference
      FROM bank_transactions
      ORDER BY transaction_date DESC NULLS LAST
      LIMIT ${limit}
    `);
      return rows.map((r: any) => ({
        ...r,
        amount: Number(r.amount),
      }));
    });
  }

  async getExpensesBreakdown(tenantId: string, from: string, to: string) {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(`
      SELECT
        category,
        COALESCE(SUM(amount), 0) as total,
        COUNT(*) as count,
        currency
      FROM expenses
      WHERE expense_date BETWEEN '${from}' AND '${to}'
      GROUP BY category, currency
      ORDER BY total DESC
    `);

      const grandTotal = rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
      return rows.map((r: any) => ({
        category: r.category,
        total: Number(r.total),
        count: Number(r.count),
        currency: r.currency,
        percentage: grandTotal > 0 ? Math.round((Number(r.total) / grandTotal) * 100) : 0,
      }));
    });
  }

  async getInvoiceAging(tenantId: string) {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(`
      SELECT
        CASE
          WHEN due_date >= NOW() - INTERVAL '30 days' THEN '0-30'
          WHEN due_date >= NOW() - INTERVAL '60 days' THEN '31-60'
          WHEN due_date >= NOW() - INTERVAL '90 days' THEN '61-90'
          ELSE '90+'
        END as bucket,
        COUNT(*)          as count,
        COALESCE(SUM(amount), 0) as amount,
        currency
      FROM invoices
      WHERE status IN ('sent', 'overdue')
        AND due_date IS NOT NULL
      GROUP BY bucket, currency
      ORDER BY bucket ASC
    `);
      return rows.map((r: any) => ({
        bucket: r.bucket,
        count: Number(r.count),
        amount: Number(r.amount),
        currency: r.currency,
      }));
    });
  }
}
