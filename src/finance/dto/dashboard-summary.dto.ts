export class CashFlowDto {
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
}

export class AgingBucketDto {
  current: number; // 0-30 days
  overdue30: number; // 31-60 days
  overdue60: number; // 61-90 days
  overdue90: number; // 90+ days
}

export class FinanceDashboardDto {
  cashFlow: CashFlowDto;
  agingReport: AgingBucketDto;
  recentAnomaliesCount: number;
}
