import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { AnalyticsCacheService } from '@analytics/analytics-cache.service';
import { tenantContext, TenantContext, UserRole } from '@common/context/tenant-context';

@Processor('summary-precompute')
export class SummaryPrecomputeProcessor {
  private readonly logger = new Logger(SummaryPrecomputeProcessor.name);

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly cache: AnalyticsCacheService,
  ) {}

  @Process('precompute-all')
  async handle(_job: Job): Promise<void> {
    this.logger.log('Nightly KPI precompute start');

    const tenants = await this.tenantDb.executePublic<{ id: string; schemaName: string }>(
      `SELECT id, schema_name AS "schemaName" FROM public.tenants WHERE status = $1`,
      ['active'],
    );

    const results = await Promise.allSettled(
      tenants.map((t) => this.runForTenant(t.id, t.schemaName)),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    this.logger.log(`Precompute done — ${tenants.length} tenants, ${failed} failed`);
  }

  private async runForTenant(tenantId: string, schemaName: string): Promise<void> {
    const ctx: TenantContext = {
      tenantId,
      schemaName,
      userId: 'system-job',
      userEmail: 'system@platform.local',
      userRole: UserRole.SYSTEM_JOB,
      requestId: `precompute-${tenantId}-${Date.now()}`,
      timestamp: new Date(),
    };

    // run() ensures that getActiveTenantId() inside the service finds this context
    await tenantContext.run(ctx, () => this.cache.buildAndCache());
  }
}
