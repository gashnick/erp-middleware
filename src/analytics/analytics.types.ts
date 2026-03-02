export interface MonthlyRevenue {
  month: number;
  year: number;
  revenue: number;
  currency: string;
}

export interface ExpenseCategory {
  category: string;
  vendorId: string;
  vendorName: string;
  total: number;
  currency: string;
}

export interface CashPosition {
  balance: number;
  currency: string;
  asOf: Date;
}

export interface KpiSnapshot {
  tenantId: string;
  generatedAt: Date;
  revenueCurrentYear: MonthlyRevenue[];
  expenseBreakdownLast90Days: ExpenseCategory[];
  cashPosition: CashPosition;
}
