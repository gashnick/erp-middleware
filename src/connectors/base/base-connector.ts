import { Logger } from '@nestjs/common';
import {
  IConnector,
  ConnectorType,
  ConnectorConfig,
  ConnectionTestResult,
  FetchOptions,
  ConnectorData,
  SyncResult,
} from '../interfaces/connector.interface';
import { EtlService } from '../../etl/services/etl.service';

export abstract class BaseConnector implements IConnector {
  protected readonly logger: Logger;

  constructor(
    public readonly type: ConnectorType,
    public readonly name: string,
    protected readonly etlService: EtlService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  abstract testConnection(config: ConnectorConfig): Promise<ConnectionTestResult>;
  abstract fetchData(config: ConnectorConfig, options?: FetchOptions): Promise<ConnectorData[]>;

  async sync(tenantId: string, config: ConnectorConfig): Promise<SyncResult> {
    this.logger.log(`Starting sync for ${this.type} connector, tenant: ${tenantId}`);

    try {
      const data = await this.fetchData(config);
      const records = data.map((item) => item.data);

      const result = await this.etlService.runInvoiceEtl(tenantId, records, this.type);

      this.logger.log(`Sync completed: ${result.synced} synced, ${result.quarantined} quarantined`);
      return result;
    } catch (error) {
      this.logger.error(`Sync failed: ${error.message}`);
      throw error;
    }
  }
}
