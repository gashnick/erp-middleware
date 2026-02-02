import { ConnectorResult, IConnector } from '@connectors/interfaces/connector.interface';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PostgresProvider implements IConnector {
  async validateConfig(config: any): Promise<boolean> {
    return !!(config.host && config.database);
  }

  async fetchData(params: any): Promise<ConnectorResult> {
    try {
      // FIX: Explicitly type the array to satisfy the TS compiler
      const data: any[] = [];

      return {
        success: true,
        data,
        rawCount: data.length,
        validCount: data.length,
      };
    } catch (e: any) {
      return {
        success: false,
        error: e.message,
        rawCount: 0,
        validCount: 0,
      };
    }
  }
}
