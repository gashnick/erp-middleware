import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

@Injectable()
export class ConnectorHealthService {
  private readonly logger = new Logger(ConnectorHealthService.name);

  // Configuration for backoff logic
  private readonly MAX_RETRIES = 5;
  private readonly BASE_DELAY_MIN = 5;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  /**
   * Updates the connector state on failure using Exponential Backoff.
   * Uses executePublic because connector metadata lives in the shared public schema.
   */
  async handleSyncFailure(connectorId: string, error: string) {
    try {
      // 1. Fetch current retry count using public context
      const result = await this.tenantDb.executePublic(
        `SELECT retry_count FROM public.connectors WHERE id = $1`,
        [connectorId],
      );

      if (!result.length) {
        this.logger.warn(`Attempted to handle failure for non-existent connector: ${connectorId}`);
        return;
      }

      const connector = result[0];
      const newRetryCount = (connector.retry_count || 0) + 1;

      if (newRetryCount > this.MAX_RETRIES) {
        // Permanent Error: Requires Admin Intervention
        await this.tenantDb.executePublic(
          `UPDATE public.connectors 
           SET status = 'error', 
               error_message = $1, 
               updated_at = NOW() 
           WHERE id = $2`,
          [`Max retries exceeded: ${error}`, connectorId],
        );
        this.logger.error(`Connector ${connectorId} marked as PERMANENT ERROR.`);
      } else {
        // Calculate Backoff: 5, 10, 20, 40, 80 minutes
        const delay = this.BASE_DELAY_MIN * Math.pow(2, connector.retry_count || 0);
        const nextSync = new Date();
        nextSync.setMinutes(nextSync.getMinutes() + delay);

        await this.tenantDb.executePublic(
          `UPDATE public.connectors 
           SET status = 'warning', 
               retry_count = $1, 
               next_sync_at = $2, 
               error_message = $3, 
               updated_at = NOW() 
           WHERE id = $4`,
          [newRetryCount, nextSync, error, connectorId],
        );
        this.logger.warn(
          `Connector ${connectorId} failure. Retrying in ${delay}m (Attempt ${newRetryCount})`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to update connector health: ${err.message}`);
      throw err;
    }
  }

  /**
   * Resets health metrics on a successful sync.
   */
  async handleSyncSuccess(connectorId: string) {
    await this.tenantDb.executePublic(
      `UPDATE public.connectors 
       SET status = 'active', 
           retry_count = 0, 
           last_sync_at = NOW(), 
           next_sync_at = NULL,
           error_message = NULL, 
           updated_at = NOW() 
       WHERE id = $1`,
      [connectorId],
    );
    this.logger.log(`Connector ${connectorId} synchronized successfully.`);
  }
}
