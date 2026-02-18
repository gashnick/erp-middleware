import { IsOptional, IsDateString, IsEnum } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'quarter', 'year'])
  groupBy?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export class RevenueAnalyticsDto {
  period: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
}

export class ExpenseBreakdownDto {
  category: string;
  amount: number;
  percentage: number;
  trend: 'up' | 'down' | 'stable';
}

export class CashPositionDto {
  date: Date;
  cashOnHand: number;
  accountsReceivable: number;
  accountsPayable: number;
  netPosition: number;
}
