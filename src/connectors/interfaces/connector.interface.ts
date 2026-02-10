// Base interface for all connectors
export interface IConnector {
  /**
   * Unique identifier for the connector type
   */
  readonly type: ConnectorType;

  /**
   * Display name for the connector
   */
  readonly name: string;

  /**
   * Test connection with provided credentials
   */
  testConnection(config: ConnectorConfig): Promise<ConnectionTestResult>;

  /**
   * Fetch data from the external source
   */
  fetchData(config: ConnectorConfig, options?: FetchOptions): Promise<ConnectorData[]>;

  /**
   * Sync data to the ERP system
   */
  sync(tenantId: string, config: ConnectorConfig): Promise<SyncResult>;
}

export enum ConnectorType {
  CSV_UPLOAD = 'csv_upload',
  XLSX_UPLOAD = 'xlsx_upload',
  QUICKBOOKS = 'quickbooks',
  ODOO = 'odoo',
  POSTGRESQL = 'postgresql',
  MYSQL = 'mysql',
  CUSTOM_API = 'custom_api',
}

export interface ConnectorConfig {
  id: string;
  tenantId: string;
  type: ConnectorType;
  credentials: Record<string, any>;
  settings: Record<string, any>;
  isActive: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: any;
}

export interface FetchOptions {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface ConnectorData {
  externalId: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface SyncResult {
  total: number;
  synced: number;
  quarantined: number;
  errors?: string[];
}
