import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

@Injectable()
export class ConnectorHealthService {
  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY_MIN = 5;

  /**
   * Updates the connector state on failure using Exponential Backoff
   */
  async handleSyncFailure(connectorId: string, error: string) {
    // 1. Fetch current retry count
    const [connector] = await this.tenantDb.execute(
      `SELECT retry_count FROM public.connectors WHERE id = $1`,
      [connectorId],
    );

    const newRetryCount = connector.retry_count + 1;

    if (newRetryCount > this.MAX_RETRIES) {
      // Permanent Error: Requires Admin Intervention
      await this.tenantDb.execute(
        `UPDATE public.connectors 
         SET status = 'error', 
             error_message = $1, 
             updated_at = NOW() 
         WHERE id = $2`,
        [`Max retries exceeded: ${error}`, connectorId],
      );
    } else {
      // Calculate Backoff: 5, 10, 20, 40, 80 minutes
      const delay = this.BASE_DELAY_MIN * Math.pow(2, connector.retry_count);
      const nextSync = new Date();
      nextSync.setMinutes(nextSync.getMinutes() + delay);

      await this.tenantDb.execute(
        `UPDATE public.connectors 
         SET status = 'error', 
             retry_count = $1, 
             next_sync_at = $2, 
             error_message = $3, 
             updated_at = NOW() 
         WHERE id = $4`,
        [newRetryCount, nextSync, error, connectorId],
      );
    }
  }

  async handleSyncSuccess(connectorId: string) {
    await this.tenantDb.execute(
      `UPDATE public.connectors 
       SET status = 'active', 
           retry_count = 0, 
           last_sync_at = NOW(), 
           error_message = NULL, 
           updated_at = NOW() 
       WHERE id = $1`,
      [connectorId],
    );
  }
}
