import { ApiProperty } from '@nestjs/swagger';

export class CashFlowDto {
  @ApiProperty({ example: 125000.5 })
  totalInvoiced: number;

  @ApiProperty({ example: 112500.25 })
  totalCollected: number;

  @ApiProperty({ example: 12500.25 })
  outstanding: number;
}

export class AgingBucketDto {
  @ApiProperty({ example: 10000 })
  current: number; // 0-30 days

  @ApiProperty({ example: 2500 })
  overdue30: number; // 31-60 days

  @ApiProperty({ example: 1500 })
  overdue60: number; // 61-90 days

  @ApiProperty({ example: 500 })
  overdue90: number; // 90+ days
}

export class ProfitabilityDto {
  @ApiProperty({ example: 0.45 })
  grossMargin: number;

  @ApiProperty({ example: 85000 })
  netProfit: number;
}

export class FinanceDashboardDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  tenantId: string; // Added for tenant verification

  @ApiProperty({ type: CashFlowDto })
  cashFlow: CashFlowDto;

  @ApiProperty({ type: AgingBucketDto })
  arAging: AgingBucketDto; // Renamed from agingReport to match test expectations

  @ApiProperty({ type: AgingBucketDto })
  apAging: AgingBucketDto; // Accounts Payable aging (placeholder)

  @ApiProperty({ type: ProfitabilityDto })
  profitability: ProfitabilityDto;

  @ApiProperty({ type: 'array', example: [] })
  anomalies: any[];

  @ApiProperty({ example: 0 })
  recentAnomaliesCount: number;
}
