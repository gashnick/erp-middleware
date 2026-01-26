import { parse } from 'csv-parse/sync';
import { BaseConnector } from '../base.connector';
import { ConnectorResult } from '../interfaces/connector.interface';

export class CsvConnector extends BaseConnector {
  async validateConfig(config: { fileType: string }): Promise<boolean> {
    return config.fileType === 'text/csv';
  }

  async fetchData(fileBuffer: Buffer): Promise<ConnectorResult> {
    try {
      const records = parse(fileBuffer, {
        columns: true, // Uses the first row as keys
        skip_empty_lines: true,
        trim: true,
      });

      return {
        success: true,
        data: records,
        rawCount: records.length,
        validCount: 0, // Will be calculated by ETL Processor
      };
    } catch (error) {
      return { success: false, error: error.message, rawCount: 0, validCount: 0 };
    }
  }
}
