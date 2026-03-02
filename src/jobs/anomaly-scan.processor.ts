import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { AnomalyService } from '@anomaly/anomaly.service';
import { tenantContext, TenantContext, UserRole } from '@common/context/tenant-context';

@Processor('anomaly-scan')
export class AnomalyScanProcessor {
  private readonly logger = new Logger(AnomalyScanProcessor.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly anomalyService: AnomalyService,
  ) {}

  @Process('scan')
  async handle(job: Job<{ tenantId: string }>): Promise<void> {
    const { tenantId } = job.data;

    const rows = await this.tenantDb.executePublic<{ schemaName: string }>(
      `SELECT schema_name AS "schemaName" FROM public.tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    if (!rows[0]) {
      this.logger.warn(`Tenant ${tenantId} not found — aborting`);
      return;
    }

    const ctx: TenantContext = {
      tenantId,
      schemaName: rows[0].schemaName,
      userId: 'system-job',
      userEmail: '',
      userRole: UserRole.SYSTEM_JOB,
      requestId: `anomaly-scan-${Date.now()}`,
      timestamp: new Date(),
    };

    await tenantContext.run(ctx, () => this.anomalyService.runScanForTenant(tenantId));
    this.logger.log(`Anomaly scan complete — tenant ${tenantId}`);
  }
}
