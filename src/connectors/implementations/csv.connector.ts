import { Injectable } from '@nestjs/common';
import { BaseConnector } from '../base/base-connector';
import {
  ConnectorType,
  ConnectorConfig,
  ConnectionTestResult,
  FetchOptions,
  ConnectorData,
} from '../interfaces/connector.interface';
import { EtlService } from '../../etl/services/etl.service';
import { parse } from 'csv-parse/sync';

@Injectable()
export class CsvConnector extends BaseConnector {
  constructor(etlService: EtlService) {
    super(ConnectorType.CSV_UPLOAD, 'CSV File Upload', etlService);
  }

  async testConnection(config: ConnectorConfig): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'CSV connector ready',
    };
  }

  async fetchData(config: ConnectorConfig, options?: FetchOptions): Promise<ConnectorData[]> {
    return [];
  }

  async parseCSV(buffer: Buffer): Promise<Record<string, any>[]> {
    try {
      const records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, any>[];
      return records;
    } catch (error) {
      throw new Error(`CSV parsing failed: ${error.message}`);
    }
  }
}
