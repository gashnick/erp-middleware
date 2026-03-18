// src/alerts/alert.types.ts

export type AlertMetric =
  | 'cash_balance'
  | 'expense_spike'
  | 'overdue_invoice_count'
  | 'unusual_payment'
  | 'sla_breach';

export type AlertOperator = 'lt' | 'gt' | 'lte' | 'gte' | 'eq';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertChannel = 'email' | 'whatsapp' | 'in_app';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  severity: AlertSeverity;
  channels: AlertChannel[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  rule?: AlertRule;
  metric: AlertMetric;
  actualValue: number;
  threshold: number;
  severity: AlertSeverity;
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  metadata: Record<string, unknown>;
  triggeredAt: Date;
}

export interface CreateAlertRuleDto {
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  severity: AlertSeverity;
  channels: AlertChannel[];
}

export interface UpdateAlertRuleDto {
  name?: string;
  operator?: AlertOperator;
  threshold?: number;
  severity?: AlertSeverity;
  channels?: AlertChannel[];
  isActive?: boolean;
}

export interface AlertRuleFilters {
  metric?: AlertMetric;
  severity?: AlertSeverity;
  isActive?: boolean;
}

export interface AlertEventFilters {
  status?: AlertStatus;
  severity?: AlertSeverity;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
