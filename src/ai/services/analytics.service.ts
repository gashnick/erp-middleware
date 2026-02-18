import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { RevenueAnalyticsDto, ExpenseBreakdownDto, CashPositionDto } from '../dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private tenantQueryRunner: TenantQueryRunnerService) {}

  async getRevenueByMonth(tenantId: string, startDate: Date, endDate: Date): Promise<RevenueAnalyticsDto[]> {
    const query = `
      WITH monthly_data AS (
        SELECT 
          DATE_TRUNC('month', created_at) as period,
          SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as revenue,
          0 as expenses
        FROM invoices
        WHERE tenant_id = $1
          AND created_at BETWEEN $2 AND $3
        GROUP BY period
      ),
      monthly_expenses AS (
        SELECT 
          DATE_TRUNC('month', expense_date) as period,
          0 as revenue,
          SUM(amount) as expenses
        FROM expenses
        WHERE tenant_id = $1
          AND expense_date BETWEEN $2 AND $3
        GROUP BY period
      ),
      combined AS (
        SELECT * FROM monthly_data
        UNION ALL
        SELECT * FROM monthly_expenses
      )
      SELECT 
        period,
        SUM(revenue) as revenue,
        SUM(expenses) as expenses,
        SUM(revenue) - SUM(expenses) as profit,
        CASE 
          WHEN SUM(revenue) > 0 THEN (SUM(revenue) - SUM(expenses)) / SUM(revenue) * 100
          ELSE 0
        END as margin
      FROM combined
      GROUP BY period
      ORDER BY period
    `;

    const results = await this.tenantQueryRunner.executeQuery(
      tenantId,
      query,
      [tenantId, startDate, endDate],
    );

    return results.map(row => ({
      period: row.period,
      revenue: parseFloat(row.revenue),
      expenses: parseFloat(row.expenses),
      profit: parseFloat(row.profit),
      margin: parseFloat(row.margin),
    }));
  }

  async getExpenseBreakdown(tenantId: string, startDate: Date, endDate: Date): Promise<ExpenseBreakdownDto[]> {
    const query = `
      WITH current_period AS (
        SELECT 
          category,
          SUM(amount) as amount
        FROM expenses
        WHERE tenant_id = $1
          AND expense_date BETWEEN $2 AND $3
        GROUP BY category
      ),
      previous_period AS (
        SELECT 
          category,
          SUM(amount) as amount
        FROM expenses
        WHERE tenant_id = $1
          AND expense_date BETWEEN $2 - INTERVAL '1 month' AND $3 - INTERVAL '1 month'
        GROUP BY category
      ),
      total AS (
        SELECT SUM(amount) as total_amount FROM current_period
      )
      SELECT 
        cp.category,
        cp.amount,
        (cp.amount / t.total_amount * 100) as percentage,
        CASE 
          WHEN pp.amount IS NULL THEN 'stable'
          WHEN cp.amount > pp.amount * 1.1 THEN 'up'
          WHEN cp.amount < pp.amount * 0.9 THEN 'down'
          ELSE 'stable'
        END as trend
      FROM current_period cp
      CROSS JOIN total t
      LEFT JOIN previous_period pp ON cp.category = pp.category
      ORDER BY cp.amount DESC
    `;

    const results = await this.tenantQueryRunner.executeQuery(
      tenantId,
      query,
      [tenantId, startDate, endDate],
    );

    return results.map(row => ({
      category: row.category,
      amount: parseFloat(row.amount),
      percentage: parseFloat(row.percentage),
      trend: row.trend,
    }));
  }

  async getCashPosition(tenantId: string): Promise<CashPositionDto> {
    const query = `
      WITH cash_data AS (
        SELECT 
          SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as cash_on_hand,
          SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as accounts_receivable
        FROM invoices
        WHERE tenant_id = $1
      ),
      payables AS (
        SELECT 
          SUM(amount) as accounts_payable
        FROM expenses
        WHERE tenant_id = $1
          AND status = 'pending'
      )
      SELECT 
        cd.cash_on_hand,
        cd.accounts_receivable,
        COALESCE(p.accounts_payable, 0) as accounts_payable,
        cd.cash_on_hand + cd.accounts_receivable - COALESCE(p.accounts_payable, 0) as net_position
      FROM cash_data cd
      CROSS JOIN payables p
    `;

    const result = await this.tenantQueryRunner.executeQuery(tenantId, query, [tenantId]);

    if (result.length === 0) {
      return {
        date: new Date(),
        cashOnHand: 0,
        accountsReceivable: 0,
        accountsPayable: 0,
        netPosition: 0,
      };
    }

    return {
      date: new Date(),
      cashOnHand: parseFloat(result[0].cash_on_hand),
      accountsReceivable: parseFloat(result[0].accounts_receivable),
      accountsPayable: parseFloat(result[0].accounts_payable),
      netPosition: parseFloat(result[0].net_position),
    };
  }

  async generateInsights(tenantId: string): Promise<string[]> {
    const insights: string[] = [];

    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      
      const revenue = await this.getRevenueByMonth(tenantId, lastMonth, now);
      const expenses = await this.getExpenseBreakdown(tenantId, lastMonth, now);
      const cashPosition = await this.getCashPosition(tenantId);

      if (revenue.length > 0) {
        const latestRevenue = revenue[revenue.length - 1];
        if (latestRevenue.margin < 10) {
          insights.push(`⚠️ Profit margin is low at ${latestRevenue.margin.toFixed(1)}%. Consider cost optimization.`);
        }
        if (latestRevenue.profit < 0) {
          insights.push(`🔴 Operating at a loss of $${Math.abs(latestRevenue.profit).toFixed(2)} this month.`);
        }
      }

      if (cashPosition.netPosition < 0) {
        insights.push(`⚠️ Negative cash position of $${Math.abs(cashPosition.netPosition).toFixed(2)}. Review payables.`);
      }

      const topExpense = expenses[0];
      if (topExpense && topExpense.percentage > 40) {
        insights.push(`📊 ${topExpense.category} accounts for ${topExpense.percentage.toFixed(1)}% of expenses.`);
      }

    } catch (error) {
      this.logger.error(`Failed to generate insights: ${error.message}`);
    }

    return insights;
  }
}
