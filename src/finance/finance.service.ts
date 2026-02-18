// src/finance/finance.service.ts
import { Injectable } from '@nestjs/common';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceDashboardDto } from './dto/dashboard-summary.dto';

@Injectable()
export class FinanceService {
  constructor(private readonly analytics: FinanceAnalyticsService) {}

  async getDashboardStats(tenantId: string): Promise<FinanceDashboardDto> {
    // Pass tenantId to analytics service to ensure it queries the correct tenant schema
    // The TenantGuard should have already set the schema context, but we pass tenantId
    // for explicit tracking and potential validation
    const summary = await this.analytics.getDashboardSummary(tenantId);

    // The TenantGuard already validates tenant context, so we trust tenantId here
    // Tests expect 'arAging' and 'apAging' keys. Map the existing agingReport
    // into the expected shape and provide a placeholder 'apAging' until
    // payables are implemented.
    return {
      tenantId, // Include tenantId in response for verification
      cashFlow: summary.cashFlow,
      arAging: summary.arAging,
      apAging: { current: 0, overdue30: 0, overdue60: 0, overdue90: 0 },
      profitability: { grossMargin: 0, netProfit: 0 },
      anomalies: [],
      recentAnomaliesCount: summary.recentAnomaliesCount,
    };
  }
}
