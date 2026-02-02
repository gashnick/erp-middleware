export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  correlationId: string; // The "Golden Thread" for your logs
  timestamp: string;
  path: string;
  tenantId?: string;
}
