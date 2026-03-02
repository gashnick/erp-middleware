import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { MonthlyRevenue, ExpenseCategory, CashPosition } from './analytics.types';

@Injectable()
export class AnalyticsRepository {
  private static readonly REVENUE_BY_MONTH_SQL = `
    SELECT
      EXTRACT(MONTH FROM invoice_date)::int AS month,
      EXTRACT(YEAR  FROM invoice_date)::int AS year,
      SUM(amount)                           AS revenue,
      currency
    FROM invoices
    WHERE EXTRACT(YEAR FROM invoice_date) = $1
      AND status = 'paid'
    GROUP BY month, year, currency
    ORDER BY month
  `;

  private static readonly EXPENSE_BREAKDOWN_SQL = `
    SELECT
      e.category,
      e.vendor_id   AS "vendorId",
      v.name         AS "vendorName",
      SUM(e.amount) AS total,
      e.currency
    FROM expenses e
    JOIN contacts v ON v.id = e.vendor_id  -- Renamed 'vendors' to 'contacts' to match your migration
    WHERE e.expense_date BETWEEN $1 AND $2
    GROUP BY e.category, e.vendor_id, v.name, e.currency
    ORDER BY total DESC
  `;

  private static readonly CASH_POSITION_SQL = `
    SELECT
      SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) AS balance,
      currency,
      $1::date AS "asOf"
    FROM bank_transactions
    WHERE transaction_date <= $1
    GROUP BY currency
    ORDER BY balance DESC
    LIMIT 1
  `;

  private static readonly VENDOR_SPEND_HISTORY_SQL = `
    SELECT
      e.vendor_id                           AS "vendorId",
      v.name                                AS "vendorName",
      EXTRACT(MONTH FROM e.expense_date)::int AS month,
      EXTRACT(YEAR  FROM e.expense_date)::int AS year,
      SUM(e.amount)                           AS spend
    FROM expenses e
    JOIN contacts v ON v.id = e.vendor_id
    WHERE ($1::uuid IS NULL OR e.vendor_id = $1)
      AND e.expense_date >= NOW() - ($2 * INTERVAL '1 month')
    GROUP BY e.vendor_id, v.name, month, year
    ORDER BY e.vendor_id, year, month
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async getRevenueByMonth(year: number): Promise<MonthlyRevenue[]> {
    return this.tenantDb.transaction(async (runner) =>
      runner.query(AnalyticsRepository.REVENUE_BY_MONTH_SQL, [year]),
    );
  }

  async getExpenseBreakdown(from: Date, to: Date): Promise<ExpenseCategory[]> {
    return this.tenantDb.transaction(async (runner) =>
      runner.query(AnalyticsRepository.EXPENSE_BREAKDOWN_SQL, [from, to]),
    );
  }

  async getCashPosition(asOf: Date = new Date()): Promise<CashPosition | null> {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(AnalyticsRepository.CASH_POSITION_SQL, [asOf]);
      return rows[0] ?? null;
    });
  }

  async getVendorSpendHistory(
    vendorId: string | null,
    lookbackMonths: number,
  ): Promise<
    { vendorId: string; vendorName: string; month: number; year: number; spend: number }[]
  > {
    return this.tenantDb.transaction(async (runner) =>
      runner.query(AnalyticsRepository.VENDOR_SPEND_HISTORY_SQL, [vendorId, lookbackMonths]),
    );
  }
}
