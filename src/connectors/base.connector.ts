import { Logger } from '@nestjs/common';
import { IConnector, ConnectorResult } from './interfaces/connector.interface';

export abstract class BaseConnector implements IConnector {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly tenantId: string) {}

  abstract validateConfig(config: any): Promise<boolean>;
  abstract fetchData(params: any): Promise<ConnectorResult>;

  // Shared utility: Standardized logging for all connectors
  protected logSyncStatus(result: ConnectorResult) {
    this.logger.log(
      `Tenant ${this.tenantId} Sync: ${result.validCount}/${result.rawCount} records successful.`,
    );
  }
}
