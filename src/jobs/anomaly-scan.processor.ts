// src/jobs/anomaly-scan.processor.ts
//
// Responsibility: consume Bull jobs, establish AsyncLocalStorage tenant context,
// then delegate to AnomalyService. No business logic here.
//
// Why this matters for search_path:
//   tenantContext.run(ctx, ...) sets the AsyncLocalStorage store.
//   TenantQueryRunnerService.transaction() reads schemaName from that store
//   on every query — so all DB calls inside runScanForTenant automatically
//   execute under SET search_path = tenant_schema, public.

import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { AnomalyService } from '@anomaly/anomaly.service';
import { tenantContext, TenantContext, UserRole } from '@common/context/tenant-context';

interface ScanJobPayload {
  tenantId: string;
  schemaName?: string; // present on new jobs — skips the DB lookup below
}

@Processor('anomaly-scan')
export class AnomalyScanProcessor {
  private readonly logger = new Logger(AnomalyScanProcessor.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly anomalyService: AnomalyService,
  ) {}

  // Handle new job name enqueued by AnomalyService.enqueueScan()
  @Process('run-scan')
  async handleRunScan(job: Job<ScanJobPayload>): Promise<void> {
    return this.process(job);
  }

  // Handle legacy job name for backwards compatibility
  @Process('scan')
  async handleScan(job: Job<ScanJobPayload>): Promise<void> {
    return this.process(job);
  }

  // ── Core processing ────────────────────────────────────────────────────────

  private async process(job: Job<ScanJobPayload>): Promise<void> {
    const { tenantId } = job.data;

    if (!tenantId) {
      throw new Error(`Job ${job.id} missing tenantId in payload — cannot process`);
    }

    this.logger.log(`Processing scan job ${job.id} for tenant ${tenantId}`);

    // Use schemaName from payload if available, otherwise look it up from DB
    const schemaName = job.data.schemaName ?? (await this.resolveSchemaName(tenantId));

    if (!schemaName) {
      this.logger.warn(`Tenant ${tenantId} not found in public.tenants — aborting job ${job.id}`);
      return;
    }

    // Establish AsyncLocalStorage context — this is what TenantQueryRunnerService
    // reads to set search_path on every subsequent DB call inside runScanForTenant
    const ctx: TenantContext = {
      tenantId,
      schemaName,
      userId: 'system-job',
      userEmail: '',
      userRole: UserRole.SYSTEM_JOB,
      requestId: `anomaly-scan-${job.id}-${Date.now()}`,
      timestamp: new Date(),
    };

    await tenantContext.run(ctx, () => this.anomalyService.runScanForTenant(tenantId, schemaName));
  }

  @OnQueueCompleted()
  onCompleted(job: Job<ScanJobPayload>): void {
    this.logger.log(`Scan job ${job.id} completed for tenant ${job.data.tenantId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job<ScanJobPayload>, error: Error): void {
    this.logger.error(
      `Scan job ${job.id} failed for tenant ${job.data.tenantId}: ${error.message}`,
      error.stack,
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Fallback schema lookup for jobs that don't have schemaName in the payload.
   * Uses executePublic to query public.tenants without a tenant context.
   */
  private async resolveSchemaName(tenantId: string): Promise<string | null> {
    const rows = await this.tenantDb.executePublic<{ schemaName: string }>(
      `SELECT schema_name AS "schemaName" FROM public.tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.schemaName ?? null;
  }
}
