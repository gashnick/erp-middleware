export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  explanation: string;
  affectedEntity: {
    type: string;
    id: string;
    name: string;
  };
  detectedAt: Date;
  metadata: Record<string, any>;
}

export enum AnomalyType {
  EXPENSE_SPIKE = 'expense_spike',
  DUPLICATE_INVOICE = 'duplicate_invoice',
  UNUSUAL_PAYMENT = 'unusual_payment',
  REVENUE_DROP = 'revenue_drop',
  CASH_FLOW_ANOMALY = 'cash_flow_anomaly',
}

export interface AnomalyDetectionResult {
  anomalies: Anomaly[];
  totalCount: number;
  highSeverityCount: number;
}
