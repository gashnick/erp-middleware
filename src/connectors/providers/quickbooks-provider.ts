import { ConnectorResult, IConnector } from '@connectors/interfaces/connector.interface';
import { Injectable } from '@nestjs/common';

@Injectable()
export class QuickbooksProvider implements IConnector {
  async validateConfig(config: any): Promise<boolean> {
    return !!config.accessToken;
  }

  async fetchData(params: any): Promise<ConnectorResult> {
    // Logic: HTTP Call to QuickBooks API
    return { success: true, data: [], rawCount: 0, validCount: 0 };
  }
}
