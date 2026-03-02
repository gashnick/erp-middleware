// src/connectors/base.connector.ts
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

/**
 * Abstract Base Connector
 * Following the Senior refactor, this class is now 'Secret-Agnostic'.
 * It focuses purely on the data bridge between external providers and the ETL engine.
 */
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

  /**
   * Orchestrates the fetch-and-transform flow.
   * Note: Encryption is handled automatically within EtlService -> EncryptionService.
   */
  async sync(tenantId: string, config: ConnectorConfig): Promise<SyncResult> {
    this.logger.log(`Starting sync for ${this.type} connector | Tenant: ${tenantId}`);

    try {
      // 1. Fetch raw data from external provider (implemented by subclass)
      const data = await this.fetchData(config);
      const records = data.map((item) => item.data);

      // 2. Pass to ETL.
      // Architecture Win: No need to fetch tenant secrets here anymore.
      const result = await this.etlService.runInvoiceEtl(tenantId, records, this.type);

      this.logger.log(
        `Sync completed for ${tenantId}: ${result.synced} synced, ${result.quarantined} quarantined`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Sync failed for ${this.type}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
