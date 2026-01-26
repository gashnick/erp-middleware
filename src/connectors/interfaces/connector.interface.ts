export interface ConnectorResult<T = any> {
  success: boolean;
  data?: T[];
  error?: string;
  rawCount: number;
  validCount: number;
}

export interface IConnector {
  // Connect/Authorize with the external source
  validateConfig(config: any): Promise<boolean>;

  // The "Extract" part of ETL
  fetchData(params: any): Promise<ConnectorResult>;
}
