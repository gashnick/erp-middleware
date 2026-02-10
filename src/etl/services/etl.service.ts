import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { ConnectorHealthService } from '@connectors/connector-health.service';
import { runWithTenantContext } from '@common/context/tenant-context';
import { EtlTransformerService } from './etl-transformer.service';
import { QuarantineService } from './quarantine.service';
import { BatchRetryResult } from '../interfaces/etl.interfaces';

@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);
  private readonly connectorRegistry: Record<string, any> = {};

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
  ) {}

  /**
   * 🚀 External Sync Entry Point
   * Triggered by cron or manual connector sync.
   */
  async runExternalSync(tenantId: string, connectorId: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Invalid Tenant Context');

    return runWithTenantContext(
      {
        tenantId,
        schemaName: tenant.schema_name,
        userId: 'system-etl',
        userRole: 'SYSTEM',
      },
      async () => {
        try {
          const result = await this.tenantDb.executePublic(
            `SELECT * FROM public.connectors WHERE id = $1 AND tenant_id = $2`,
            [connectorId, tenantId],
          );

          const connector = result[0];
          if (!connector) throw new BadRequestException('Connector not found');

          const rawData = await this.fetchFromProvider(connector);
          const secret = await this.getTenantSecret(tenantId);

          const syncResult = await this.executeBatchWithRetry(
            tenantId,
            rawData,
            connector.type,
            secret,
          );

          await this.connectorHealth.handleSyncSuccess(connectorId);
          return syncResult;
        } catch (err) {
          this.logger.error(`Sync failed for connector ${connectorId}: ${err.message}`);
          await this.connectorHealth.handleSyncFailure(connectorId, err.message);
          throw err;
        }
      },
    );
  }

  /**
   * 🛠️ Manual Upload Entry Point
   * Triggered by CSV/JSON uploads.
   */
  async runInvoiceEtl(tenantId: string, rawData: any[], source: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Invalid Tenant');

    return runWithTenantContext(
      {
        tenantId,
        schemaName: tenant.schema_name,
        userId: 'manual-upload',
        userRole: 'ADMIN',
      },
      () => this.executeBatchWithRetry(tenantId, rawData, source, tenant.tenant_secret),
    );
  }

  /**
   * ✅ Single Record Retry (The Missing Method)
   * Moves a record from quarantine to invoices after user fixes data.
   */
  async retryQuarantineRecord(tenantId: string, recordId: string, fixedData: any, userId: string) {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    const record = await this.quarantine.findById(tenantId, recordId);
    if (!record) throw new NotFoundException('Quarantine record not found');

    const { validInvoices, quarantine } = this.transformer.transformInvoices(
      [fixedData],
      tenantId,
      tenant.tenant_secret,
      record.source_type,
    );

    if (quarantine.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed with corrected data',
        errors: quarantine[0].errors,
      });
    }

    return await this.tenantDb.transaction(async (runner) => {
      await this.upsertInvoices(runner, validInvoices);
      await runner.query(`DELETE FROM quarantine_records WHERE id = $1 AND tenant_id = $2`, [
        recordId,
        tenantId,
      ]);

      return { success: true, invoice: validInvoices[0] };
    });
  }

  /**
   * 📦 Batch Retry
   * Retries multiple records using original raw_data.
   */
  async retryQuarantineBatch(
    tenantId: string,
    recordIds: string[],
    userId: string,
  ): Promise<BatchRetryResult> {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    const records = await this.quarantine.findManyByIds(tenantId, recordIds);
    const validInvoices: any[] = [];
    const stillFailed: any[] = [];

    for (const record of records) {
      const { validInvoices: v, quarantine: q } = this.transformer.transformInvoices(
        [record.raw_data],
        tenantId,
        tenant.tenant_secret,
        record.source_type,
      );
      if (v.length > 0) validInvoices.push(v[0]);
      else stillFailed.push({ id: record.id, errors: q[0].errors });
    }

    return await this.tenantDb.transaction(async (runner) => {
      if (validInvoices.length > 0) {
        await this.upsertInvoices(runner, validInvoices);
        const successIds = records
          .filter((r) => !stillFailed.some((f) => f.id === r.id))
          .map((r) => r.id);

        await runner.query(`DELETE FROM quarantine_records WHERE id = ANY($1) AND tenant_id = $2`, [
          successIds,
          tenantId,
        ]);
      }
      return {
        totalProcessed: recordIds.length,
        succeeded: validInvoices.length,
        failed: stillFailed,
      };
    });
  }

  /** ==========================================================================
   * PRIVATE ETL LOGIC
   * ========================================================================= */

  private async executeBatchWithRetry(
    tenantId: string,
    data: any[],
    source: string,
    secret: string,
  ) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.tenantDb.transaction(async (runner) => {
          const { validInvoices, quarantine } = this.transformer.transformInvoices(
            data,
            tenantId,
            secret,
            source,
          );

          if (validInvoices.length > 0) await this.upsertInvoices(runner, validInvoices);
          if (quarantine.length > 0) await this.insertQuarantineRecords(runner, quarantine);

          return {
            total: data.length,
            synced: validInvoices.length,
            quarantined: quarantine.length,
          };
        });
      } catch (error) {
        lastError = error;
        if (this.isDeadlockError(error) && attempt < this.MAX_RETRY_ATTEMPTS) {
          await this.sleep(this.calculateRetryDelay(attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error('Batch execution failed');
  }

  private async upsertInvoices(runner: any, invoices: any[]) {
    const valuesPerRecord = 7;
    const placeholders = invoices
      .map((_, i) => {
        const base = i * valuesPerRecord + 1;
        return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb)`;
      })
      .join(', ');

    const params = invoices.flatMap((inv) => [
      inv.tenant_id,
      inv.external_id,
      inv.customer_name,
      inv.invoice_number,
      inv.amount,
      inv.status,
      JSON.stringify(inv.metadata),
    ]);

    await runner.query(
      `INSERT INTO invoices (tenant_id, external_id, customer_name, invoice_number, amount, status, metadata)
       VALUES ${placeholders}
       ON CONFLICT (tenant_id, external_id) 
       DO UPDATE SET 
         amount = EXCLUDED.amount, 
         status = EXCLUDED.status, 
         metadata = EXCLUDED.metadata,
         customer_name = EXCLUDED.customer_name`,
      params,
    );
  }

  private async insertQuarantineRecords(runner: any, records: any[]): Promise<void> {
    const valuesPerRecord = 5;
    const placeholders = records
      .map((_, i) => {
        const base = i * valuesPerRecord + 1;
        return `($${base}, $${base + 1}, $${base + 2}::jsonb, $${base + 3}::jsonb, $${base + 4})`;
      })
      .join(', ');

    const params = records.flatMap((r) => [
      r.tenant_id,
      r.source_type,
      JSON.stringify(r.raw_data),
      JSON.stringify(r.errors),
      r.status || 'pending',
    ]);

    await runner.query(
      `INSERT INTO quarantine_records (tenant_id, source_type, raw_data, errors, status) VALUES ${placeholders}`,
      params,
    );
  }

  /** ==========================================================================
   * UTILITIES
   * ========================================================================= */

  public async getTenantSecret(tenantId: string): Promise<string> {
    const tenant = await this.tenantProvisioning.findById(tenantId);
    if (!tenant?.tenant_secret) throw new InternalServerErrorException('Secret missing');
    return tenant.tenant_secret;
  }

  private async fetchFromProvider(connector: any): Promise<any[]> {
    const provider = this.connectorRegistry[connector.type];
    if (!provider) throw new InternalServerErrorException(`Provider ${connector.type} not found`);
    const result = await provider.fetchData(connector.config);
    if (!result.success) throw new Error(result.error || 'Fetch failed');
    return result.data || [];
  }

  private isDeadlockError(error: any): boolean {
    // Postgres specific deadlock error code
    return error?.code === '40P01' || error?.message?.includes('deadlock');
  }

  private calculateRetryDelay(attempt: number): number {
    return this.INITIAL_RETRY_DELAY_MS * Math.pow(this.RETRY_BACKOFF_MULTIPLIER, attempt - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
