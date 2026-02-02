// src/etl/services/etl.service.ts
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { ConnectorHealthService } from '@connectors/connector-health.service';
import { PostgresProvider } from '@connectors/providers/postgres-provider';
import { QuickbooksProvider } from '@connectors/providers/quickbooks-provider';
import { runWithTenantContext } from '@common/context/tenant-context';
import { EtlTransformerService } from './etl-transformer.service';
import { QuarantineService } from './quarantine.service';
import { FailedRetry, BatchRetryResult } from '../interfaces/etl.interfaces';

/**
 * ETL Service
 *
 * Orchestrates Extract-Transform-Load operations for multi-tenant data ingestion.
 *
 * Key Responsibilities:
 * - Coordinate data flow from connectors → transformation → database
 * - Handle transaction management with deadlock recovery
 * - Emit audit events for compliance tracking
 * - Manage quarantine retry workflows
 *
 * Design Principles:
 * - Resilient: Automatic retry on deadlocks with exponential backoff
 * - Atomic: All-or-nothing transaction semantics
 * - Observable: Comprehensive logging and event emission
 * - Secure: Parameterized queries prevent SQL injection
 */
@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);
  private readonly connectorRegistry: Record<string, any>;

  // Transaction retry configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly INITIAL_RETRY_DELAY_MS = 50;
  private readonly RETRY_BACKOFF_MULTIPLIER = 2;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly connectorHealth: ConnectorHealthService,
    private readonly transformer: EtlTransformerService,
    private readonly quarantine: QuarantineService,
    private readonly pgProvider: PostgresProvider,
    private readonly qbProvider: QuickbooksProvider,
  ) {
    this.connectorRegistry = { postgres: this.pgProvider, quickbooks: this.qbProvider };
  }

  /**
   * Executes external connector sync with automatic health tracking.
   *
   * @param tenantId - Target tenant identifier
   * @param connectorId - Connector to execute
   * @returns Sync statistics (total, synced, quarantined)
   */
  async runExternalSync(tenantId: string, connectorId: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) {
      throw new BadRequestException('Invalid Tenant Context');
    }

    return runWithTenantContext(
      {
        tenantId,
        schemaName: tenant.schema_name || 'public',
        userId: 'system-etl',
        userRole: 'SYSTEM',
      },
      async () => {
        const runner = await this.tenantDb.getRunner();
        try {
          // Fetch connector configuration (parameterized query)
          const [connector] = await runner.query(
            `SELECT * FROM public.connectors WHERE id = $1 AND tenant_id = $2`,
            [connectorId, tenantId],
          );

          if (!connector) {
            throw new BadRequestException('Connector not found');
          }

          const rawData = await this.fetchFromProvider(connector);
          const secret = await this.getTenantSecret(tenantId);

          const result = await this.executeBatchWithRetry(
            runner,
            tenantId,
            rawData,
            connector.type,
            secret,
          );

          await this.connectorHealth.handleSyncSuccess(connectorId);
          return result;
        } catch (err) {
          this.logger.error(
            `External sync failed for connector ${connectorId}: ${err.message}`,
            err.stack,
          );
          await this.connectorHealth.handleSyncFailure(connectorId, err.message);
          throw err;
        } finally {
          await runner.release();
        }
      },
    );
  }

  /**
   * Retries multiple quarantine records in a single transaction.
   *
   * @param tenantId - Target tenant identifier
   * @param recordIds - Array of quarantine record IDs to retry
   * @param userId - User performing the retry (for audit)
   * @returns Batch retry statistics
   */
  async retryQuarantineBatch(
    tenantId: string,
    recordIds: string[],
    userId: string,
  ): Promise<BatchRetryResult> {
    // Input validation
    if (!recordIds || recordIds.length === 0) {
      throw new BadRequestException('No record IDs provided for retry');
    }

    const secret = await this.getTenantSecret(tenantId);
    const records = await this.quarantine.findManyByIds(tenantId, recordIds);

    if (records.length === 0) {
      throw new BadRequestException('No records found matching provided IDs');
    }

    const validInvoices: any[] = [];
    const stillFailed: FailedRetry[] = [];

    // Re-transform each quarantine record
    for (const record of records) {
      if (!record.id) continue; // Defensive: Skip malformed records

      const { validInvoices: v, quarantine: q } = this.transformer.transformInvoices(
        [record.raw_data],
        tenantId,
        secret,
        record.source_type,
      );

      if (v.length > 0) {
        validInvoices.push(v[0]);
      } else {
        stillFailed.push({
          id: record.id,
          errors: q[0]?.errors || ['Unknown validation error'],
        });
      }
    }

    // Atomic database operation
    return await this.tenantDb.transaction(async (runner) => {
      if (validInvoices.length > 0) {
        await this.tenantDb.upsert(
          runner,
          'invoices',
          validInvoices,
          ['tenant_id', 'external_id'],
          ['amount', 'status', 'customer_name', 'invoice_number', 'metadata'],
        );

        // Delete successfully retried records (parameterized)
        const successIds = records
          .filter((r) => !stillFailed.some((f) => f.id === r.id))
          .map((r) => r.id);

        if (successIds.length > 0) {
          await runner.query(`DELETE FROM quarantine_records WHERE id = ANY($1)`, [successIds]);
        }
      }

      this.logger.log(
        `Batch retry completed: ${validInvoices.length} succeeded, ${stillFailed.length} still failed`,
      );

      return {
        totalProcessed: recordIds.length,
        succeeded: validInvoices.length,
        failed: stillFailed,
      };
    });
  }

  /**
   * Executes batch insert with automatic deadlock retry.
   *
   * This method wraps executeBatch with retry logic to handle PostgreSQL deadlocks
   * that can occur during concurrent CSV uploads.
   *
   * @param runner - Database query runner
   * @param tenantId - Target tenant identifier
   * @param data - Raw data to process
   * @param source - Data source identifier
   * @param secret - Decrypted tenant secret for encryption
   * @returns Batch processing statistics
   */
  private async executeBatchWithRetry(
    runner: any,
    tenantId: string,
    data: any[],
    source: string,
    secret: string,
  ) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.executeBatch(runner, tenantId, data, source, secret);
      } catch (error) {
        lastError = error;

        // Check if error is a deadlock
        const isDeadlock = this.isDeadlockError(error);

        if (isDeadlock && attempt < this.MAX_RETRY_ATTEMPTS) {
          const delayMs = this.calculateRetryDelay(attempt);
          this.logger.warn(
            `Deadlock detected on attempt ${attempt}/${this.MAX_RETRY_ATTEMPTS}. ` +
              `Retrying in ${delayMs}ms...`,
          );

          // Exponential backoff
          await this.sleep(delayMs);
          continue;
        }

        // Not a deadlock or max retries reached
        throw error;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError || new Error('Batch execution failed after retries');
  }

  /**
   * Executes batch transformation and database insertion.
   *
   * CRITICAL: This method must be called within a retry wrapper to handle deadlocks.
   *
   * @param runner - Database query runner
   * @param tenantId - Target tenant identifier
   * @param data - Raw data to process
   * @param source - Data source identifier
   * @param secret - Decrypted tenant secret for encryption
   * @returns Batch processing statistics
   */
  private async executeBatch(
    runner: any,
    tenantId: string,
    data: any[],
    source: string,
    secret: string,
  ) {
    // Transform data into valid invoices and quarantine records
    const { validInvoices, quarantine } = this.transformer.transformInvoices(
      data,
      tenantId,
      secret,
      source,
    );

    await runner.startTransaction();

    try {
      // Insert valid invoices with upsert logic
      if (validInvoices.length > 0) {
        await this.tenantDb.upsert(
          runner,
          'invoices',
          validInvoices,
          ['tenant_id', 'external_id'],
          ['amount', 'status', 'customer_name', 'invoice_number', 'metadata'],
        );
      }

      // Insert quarantine records (parameterized bulk insert)
      if (quarantine.length > 0) {
        await this.insertQuarantineRecords(runner, quarantine);
      }

      await runner.commitTransaction();

      return {
        total: data.length,
        synced: validInvoices.length,
        quarantined: quarantine.length,
      };
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Inserts quarantine records using parameterized bulk insert.
   *
   * Uses PostgreSQL's multi-row VALUES syntax with proper parameterization
   * to prevent SQL injection.
   *
   * @param runner - Database query runner
   * @param records - Array of quarantine records to insert
   */
  private async insertQuarantineRecords(runner: any, records: Partial<any>[]): Promise<void> {
    if (records.length === 0) return;

    // Build parameterized query
    const valuesPerRecord = 5;
    const placeholders = records
      .map((_, index) => {
        const base = index * valuesPerRecord + 1;
        return `($${base}, $${base + 1}, $${base + 2}::jsonb, $${base + 3}::jsonb, $${base + 4})`;
      })
      .join(', ');

    // Flatten parameters
    const params = records.flatMap((record) => [
      record.tenant_id,
      record.source_type,
      JSON.stringify(record.raw_data),
      JSON.stringify(record.errors),
      record.status || 'pending',
    ]);

    // Execute parameterized insert
    await runner.query(
      `INSERT INTO quarantine_records 
       (tenant_id, source_type, raw_data, errors, status) 
       VALUES ${placeholders}`,
      params,
    );
  }

  /**
   * Retrieves and decrypts tenant secret for field encryption.
   *
   * @param tenantId - Target tenant identifier
   * @returns Decrypted tenant secret
   * @throws InternalServerErrorException if secret is missing
   */
  public async getTenantSecret(tenantId: string): Promise<string> {
    const tenant = await this.tenantProvisioning.findById(tenantId);

    if (!tenant?.tenant_secret) {
      throw new InternalServerErrorException(`Tenant secret missing for tenant ${tenantId}`);
    }

    return tenant.tenant_secret;
  }

  /**
   * Fetches data from external connector provider.
   *
   * @param connector - Connector configuration
   * @returns Raw data array from provider
   */
  private async fetchFromProvider(connector: any): Promise<any[]> {
    const provider = this.connectorRegistry[connector.type];

    if (!provider) {
      throw new InternalServerErrorException(`Provider "${connector.type}" not registered`);
    }

    const result = await provider.fetchData(connector.config);

    if (!result.success) {
      throw new Error(result.error || 'Provider fetch failed');
    }

    return result.data || [];
  }

  /**
   * Retries a single quarantine record with corrected data.
   *
   * @param tenantId - Target tenant identifier
   * @param recordId - Quarantine record ID
   * @param fixedData - Corrected data to retry
   * @param userId - User performing the retry (for audit)
   * @returns Success status and created invoice
   */
  async retryQuarantineRecord(tenantId: string, recordId: string, fixedData: any, userId: string) {
    const secret = await this.getTenantSecret(tenantId);

    // 1. Fetch the quarantine record
    const record = await this.quarantine.findById(tenantId, recordId);
    if (!record) {
      throw new BadRequestException('Quarantine record not found');
    }

    // 2. Re-transform with fixed data
    const { validInvoices, quarantine } = this.transformer.transformInvoices(
      [fixedData],
      tenantId,
      secret,
      record.source_type,
    );

    // 3. Validate that fixed data passes
    if (quarantine.length > 0) {
      throw new BadRequestException({
        message: 'Fixed data still failed validation',
        errors: quarantine[0].errors,
      });
    }

    // 4. Atomic swap: Insert invoice and delete quarantine record
    return await this.tenantDb.transaction(async (runner) => {
      await this.tenantDb.upsert(
        runner,
        'invoices',
        validInvoices,
        ['tenant_id', 'external_id'],
        ['amount', 'status', 'customer_name', 'invoice_number', 'metadata', 'due_date'],
      );

      // Delete quarantine record (parameterized)
      await runner.query(`DELETE FROM quarantine_records WHERE id = $1`, [recordId]);

      // Emit audit event
      this.eventEmitter.emit('audit.log', {
        tenantId,
        userId,
        action: 'QUARANTINE_RETRY_SUCCESS',
        metadata: { recordId, externalId: validInvoices[0].external_id },
      });

      return { success: true, invoice: validInvoices[0] };
    });
  }

  /**
   * Manually triggers ETL for CSV uploads.
   *
   * @param tenantId - Target tenant identifier
   * @param rawData - Raw CSV data to process
   * @param source - Source identifier (e.g., 'csv_upload')
   * @returns Processing statistics
   */
  async runInvoiceEtl(tenantId: string, rawData: any[], source: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) {
      throw new BadRequestException('Invalid Tenant Context');
    }

    return runWithTenantContext(
      {
        tenantId,
        schemaName: tenant.schema_name || 'public',
        userId: 'manual-upload',
        userRole: 'ADMIN',
      },
      async () => {
        const runner = await this.tenantDb.getRunner();
        const secret = await this.getTenantSecret(tenantId);

        try {
          const result = await this.executeBatchWithRetry(
            runner,
            tenantId,
            rawData,
            source,
            secret,
          );

          this.logger.log(
            `Manual CSV sync completed for tenant ${tenantId}: ` +
              `${result.synced} synced, ${result.quarantined} quarantined`,
          );

          return result;
        } catch (err) {
          this.logger.error(
            `Manual CSV sync failed for tenant ${tenantId}: ${err.message}`,
            err.stack,
          );
          throw err;
        } finally {
          await runner.release();
        }
      },
    );
  }

  // ==================== Utility Methods ====================

  /**
   * Determines if an error is a PostgreSQL deadlock.
   *
   * @param error - Error to check
   * @returns True if error is a deadlock
   */
  private isDeadlockError(error: any): boolean {
    return (
      error?.message?.includes('deadlock') ||
      error?.code === '40P01' || // PostgreSQL deadlock error code
      error?.message?.includes('could not serialize access')
    );
  }

  /**
   * Calculates exponential backoff delay.
   *
   * @param attempt - Current retry attempt number (1-based)
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    return this.INITIAL_RETRY_DELAY_MS * Math.pow(this.RETRY_BACKOFF_MULTIPLIER, attempt - 1);
  }

  /**
   * Sleep utility for retry delays.
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
