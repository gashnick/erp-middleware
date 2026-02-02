// src/finance/finance.service.ts
import { Injectable } from '@nestjs/common';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceDashboardDto } from './dto/dashboard-summary.dto';

@Injectable()
export class FinanceService {
  constructor(private readonly analytics: FinanceAnalyticsService) {}

  async getDashboardStats(tenantId: string): Promise<FinanceDashboardDto> {
    // We pass the tenantId to ensure the QueryRunner switches to the correct schema
    // This satisfies the "Data Isolation" requirement
    return this.analytics.getDashboardSummary();
  }
}
