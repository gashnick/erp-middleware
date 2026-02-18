import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { ContextData } from '../interfaces/llm.interface';

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private tenantQueryRunner: TenantQueryRunnerService,
  ) {}

  async buildContext(tenantId: string, query: string): Promise<ContextData> {
    const timeRange = this.extractTimeRange(query);
    const entities = this.extractEntities(query);

    const metrics = await this.fetchRelevantMetrics(tenantId, timeRange, entities);

    return {
      tenantId,
      timeRange,
      entities,
      metrics: this.redactPII(metrics),
    };
  }

  private extractTimeRange(query: string): { start: Date; end: Date } | undefined {
    const now = new Date();
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('today')) {
      return { start: new Date(now.setHours(0, 0, 0, 0)), end: new Date() };
    }
    if (lowerQuery.includes('this week')) {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      return { start, end: new Date() };
    }
    if (lowerQuery.includes('this month')) {
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date() };
    }
    if (lowerQuery.includes('q1')) {
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 2, 31) };
    }
    if (lowerQuery.includes('q2')) {
      return { start: new Date(now.getFullYear(), 3, 1), end: new Date(now.getFullYear(), 5, 30) };
    }
    if (lowerQuery.includes('q3')) {
      return { start: new Date(now.getFullYear(), 6, 1), end: new Date(now.getFullYear(), 8, 30) };
    }
    if (lowerQuery.includes('q4')) {
      return { start: new Date(now.getFullYear(), 9, 1), end: new Date(now.getFullYear(), 11, 31) };
    }

    // Default: last 30 days
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    return { start, end: new Date() };
  }

  private extractEntities(query: string): string[] {
    const entities: string[] = [];
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('invoice')) entities.push('invoice');
    if (lowerQuery.includes('payment')) entities.push('payment');
    if (lowerQuery.includes('customer')) entities.push('customer');
    if (lowerQuery.includes('vendor')) entities.push('vendor');
    if (lowerQuery.includes('expense')) entities.push('expense');
    if (lowerQuery.includes('revenue')) entities.push('revenue');
    if (lowerQuery.includes('profit')) entities.push('profit');

    return entities;
  }

  private async fetchRelevantMetrics(
    tenantId: string,
    timeRange: { start: Date; end: Date } | undefined,
    entities: string[],
  ): Promise<Record<string, any>> {
    const metrics: Record<string, any> = {};

    try {
      if (entities.includes('invoice') || entities.includes('revenue')) {
        metrics.invoices = await this.fetchInvoiceMetrics(tenantId, timeRange);
      }

      if (entities.includes('payment')) {
        metrics.payments = await this.fetchPaymentMetrics(tenantId, timeRange);
      }

      if (entities.includes('expense')) {
        metrics.expenses = await this.fetchExpenseMetrics(tenantId, timeRange);
      }

      metrics.summary = await this.fetchSummaryMetrics(tenantId, timeRange);
    } catch (error) {
      this.logger.error(`Failed to fetch metrics: ${error.message}`);
    }

    return metrics;
  }

  private async fetchInvoiceMetrics(tenantId: string, timeRange: any) {
    const query = `
      SELECT 
        COUNT(*) as total_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount,
        status,
        COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count
      FROM invoices
      WHERE tenant_id = $1
      ${timeRange ? 'AND created_at BETWEEN $2 AND $3' : ''}
      GROUP BY status
    `;

    const params = timeRange ? [tenantId, timeRange.start, timeRange.end] : [tenantId];
    return await this.tenantQueryRunner.executeQuery(tenantId, query, params);
  }

  private async fetchPaymentMetrics(tenantId: string, timeRange: any) {
    const query = `
      SELECT 
        COUNT(*) as total_payments,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM payments
      WHERE tenant_id = $1
      ${timeRange ? 'AND payment_date BETWEEN $2 AND $3' : ''}
    `;

    const params = timeRange ? [tenantId, timeRange.start, timeRange.end] : [tenantId];
    return await this.tenantQueryRunner.executeQuery(tenantId, query, params);
  }

  private async fetchExpenseMetrics(tenantId: string, timeRange: any) {
    const query = `
      SELECT 
        COUNT(*) as total_expenses,
        SUM(amount) as total_amount,
        category,
        COUNT(*) as count_per_category
      FROM expenses
      WHERE tenant_id = $1
      ${timeRange ? 'AND expense_date BETWEEN $2 AND $3' : ''}
      GROUP BY category
    `;

    const params = timeRange ? [tenantId, timeRange.start, timeRange.end] : [tenantId];
    return await this.tenantQueryRunner.executeQuery(tenantId, query, params);
  }

  private async fetchSummaryMetrics(tenantId: string, timeRange: any) {
    return {
      totalRevenue: 0,
      totalExpenses: 0,
      netProfit: 0,
      invoiceCount: 0,
      customerCount: 0,
    };
  }

  private redactPII(data: any): any {
    const redacted = JSON.parse(JSON.stringify(data));
    
    const redactObject = (obj: any) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Redact email
          obj[key] = obj[key].replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
          // Redact phone
          obj[key] = obj[key].replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]');
          // Redact SSN
          obj[key] = obj[key].replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redactObject(obj[key]);
        }
      }
    };

    redactObject(redacted);
    return redacted;
  }
}
