export class AIInsight {
  id: string;
  tenantId: string;
  targetEntity: string; // 'invoice', 'customer', 'vendor', etc.
  targetId: string;
  insightType: string; // 'anomaly', 'recommendation', 'prediction', 'analysis'
  message: string;
  confidence: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}
