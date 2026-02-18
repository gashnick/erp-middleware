import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { AIInsightsService } from './ai-insights.service';
import { Anomaly, AnomalyType, AnomalyDetectionResult } from '../interfaces/anomaly.interface';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    private tenantQueryRunner: TenantQueryRunnerService,
    private aiInsightsService: AIInsightsService,
  ) {}

  async detectAnomalies(tenantId: string): Promise<AnomalyDetectionResult> {
    const anomalies: Anomaly[] = [];

    try {
      const expenseAnomalies = await this.detectExpenseSpikes(tenantId);
      const duplicateInvoices = await this.detectDuplicateInvoices(tenantId);
      const unusualPayments = await this.detectUnusualPayments(tenantId);

      anomalies.push(...expenseAnomalies, ...duplicateInvoices, ...unusualPayments);

      // Save anomalies as insights
      await this.saveAnomaliesAsInsights(tenantId, anomalies);
    } catch (error) {
      this.logger.error(`Anomaly detection failed: ${error.message}`);
    }

    const highSeverityCount = anomalies.filter(a => a.severity === 'high' || a.severity === 'critical').length;

    return {
      anomalies,
      totalCount: anomalies.length,
      highSeverityCount,
    };
  }

  private async detectExpenseSpikes(tenantId: string): Promise<Anomaly[]> {
    const query = `
      WITH monthly_expenses AS (
        SELECT 
          DATE_TRUNC('month', expense_date) as month,
          vendor_name,
          SUM(amount) as total_amount
        FROM expenses
        WHERE tenant_id = $1
          AND expense_date >= NOW() - INTERVAL '6 months'
        GROUP BY month, vendor_name
      ),
      vendor_stats AS (
        SELECT 
          vendor_name,
          AVG(total_amount) as avg_amount,
          STDDEV(total_amount) as stddev_amount
        FROM monthly_expenses
        GROUP BY vendor_name
      )
      SELECT 
        me.vendor_name,
        me.total_amount,
        vs.avg_amount,
        vs.stddev_amount,
        me.month
      FROM monthly_expenses me
      JOIN vendor_stats vs ON me.vendor_name = vs.vendor_name
      WHERE me.total_amount > (vs.avg_amount + 2 * vs.stddev_amount)
      ORDER BY me.month DESC
      LIMIT 10
    `;

    const results = await this.tenantQueryRunner.executeQuery(tenantId, query, [tenantId]);
    
    return results.map(row => ({
      id: uuidv4(),
      type: AnomalyType.EXPENSE_SPIKE,
      severity: this.calculateSeverity(row.total_amount, row.avg_amount),
      score: this.calculateAnomalyScore(row.total_amount, row.avg_amount, row.stddev_amount),
      description: `Unusual expense spike for ${row.vendor_name}`,
      explanation: `Expense of $${row.total_amount.toFixed(2)} is ${((row.total_amount / row.avg_amount - 1) * 100).toFixed(1)}% higher than the average of $${row.avg_amount.toFixed(2)}`,
      affectedEntity: {
        type: 'vendor',
        id: row.vendor_name,
        name: row.vendor_name,
      },
      detectedAt: new Date(),
      metadata: {
        month: row.month,
        currentAmount: row.total_amount,
        averageAmount: row.avg_amount,
        standardDeviation: row.stddev_amount,
      },
    }));
  }

  private async detectDuplicateInvoices(tenantId: string): Promise<Anomaly[]> {
    const query = `
      SELECT 
        customer_name,
        amount,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id) as invoice_ids,
        MIN(created_at) as first_created,
        MAX(created_at) as last_created
      FROM invoices
      WHERE tenant_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY customer_name, amount
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
      LIMIT 10
    `;

    const results = await this.tenantQueryRunner.executeQuery(tenantId, query, [tenantId]);

    return results.map(row => ({
      id: uuidv4(),
      type: AnomalyType.DUPLICATE_INVOICE,
      severity: row.duplicate_count > 3 ? 'high' : 'medium',
      score: Math.min(row.duplicate_count / 5, 1),
      description: `Potential duplicate invoices detected`,
      explanation: `Found ${row.duplicate_count} invoices with identical customer (${row.customer_name}) and amount ($${row.amount})`,
      affectedEntity: {
        type: 'invoice',
        id: row.invoice_ids[0],
        name: `Invoice for ${row.customer_name}`,
      },
      detectedAt: new Date(),
      metadata: {
        duplicateCount: row.duplicate_count,
        invoiceIds: row.invoice_ids,
        amount: row.amount,
        customerName: row.customer_name,
        timeSpan: {
          first: row.first_created,
          last: row.last_created,
        },
      },
    }));
  }

  private async detectUnusualPayments(tenantId: string): Promise<Anomaly[]> {
    const query = `
      WITH payment_stats AS (
        SELECT 
          AVG(amount) as avg_amount,
          STDDEV(amount) as stddev_amount
        FROM payments
        WHERE tenant_id = $1
          AND payment_date >= NOW() - INTERVAL '90 days'
      )
      SELECT 
        p.id,
        p.amount,
        p.payment_date,
        p.payment_method,
        ps.avg_amount,
        ps.stddev_amount
      FROM payments p
      CROSS JOIN payment_stats ps
      WHERE p.tenant_id = $1
        AND p.payment_date >= NOW() - INTERVAL '30 days'
        AND (p.amount > (ps.avg_amount + 3 * ps.stddev_amount) 
             OR p.amount < (ps.avg_amount - 3 * ps.stddev_amount))
      ORDER BY p.payment_date DESC
      LIMIT 10
    `;

    const results = await this.tenantQueryRunner.executeQuery(tenantId, query, [tenantId]);

    return results.map(row => ({
      id: uuidv4(),
      type: AnomalyType.UNUSUAL_PAYMENT,
      severity: this.calculateSeverity(row.amount, row.avg_amount),
      score: this.calculateAnomalyScore(row.amount, row.avg_amount, row.stddev_amount),
      description: `Unusual payment amount detected`,
      explanation: `Payment of $${row.amount.toFixed(2)} deviates significantly from average payment of $${row.avg_amount.toFixed(2)}`,
      affectedEntity: {
        type: 'payment',
        id: row.id,
        name: `Payment ${row.id}`,
      },
      detectedAt: new Date(),
      metadata: {
        amount: row.amount,
        averageAmount: row.avg_amount,
        paymentDate: row.payment_date,
        paymentMethod: row.payment_method,
      },
    }));
  }

  private calculateSeverity(value: number, average: number): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = Math.abs(value / average - 1);
    
    if (ratio > 3) return 'critical';
    if (ratio > 2) return 'high';
    if (ratio > 1) return 'medium';
    return 'low';
  }

  private calculateAnomalyScore(value: number, mean: number, stddev: number): number {
    if (stddev === 0) return 0;
    const zScore = Math.abs((value - mean) / stddev);
    return Math.min(zScore / 5, 1);
  }

  async explainAnomaly(tenantId: string, anomalyId: string): Promise<string> {
    // This would fetch the anomaly and provide detailed explanation
    return `Detailed explanation for anomaly ${anomalyId}`;
  }

  private async saveAnomaliesAsInsights(
    tenantId: string,
    anomalies: Anomaly[],
  ): Promise<void> {
    try {
      for (const anomaly of anomalies) {
        await this.aiInsightsService.saveInsight(
          tenantId,
          anomaly.affectedEntity.type,
          anomaly.affectedEntity.id,
          'anomaly',
          `${anomaly.description}: ${anomaly.explanation}`,
          anomaly.score,
          {
            type: anomaly.type,
            severity: anomaly.severity,
            metadata: anomaly.metadata,
          },
        );
      }
    } catch (error) {
      this.logger.error(`Failed to save anomalies as insights: ${error.message}`);
    }
  }
}
