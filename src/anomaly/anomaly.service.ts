import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PubSub } from 'graphql-subscriptions';
import { AnomalyDetector } from './anomaly.detector';
import { AnomalyRepository } from './anomaly.repository';
import { AnomalyCandidate, PersistedAnomaly, AnomalyType, VendorSpend } from './anomaly.types';
import { AnalyticsRepository } from '@analytics/analytics.repository';
import { PUB_SUB } from '@common/pubsub/pubsub.token';
import { AuditLogService, AuditAction } from '@common/audit/audit-log.service';
import { systemAuditMeta } from '@common/audit/audit.helpers';
import { getTenantContext } from '@common/context/tenant-context';

const HIGH_CONFIDENCE_THRESHOLD = 0.8;

@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    private readonly detector: AnomalyDetector,
    private readonly repo: AnomalyRepository,
    private readonly analytics: AnalyticsRepository,
    private readonly audit: AuditLogService,
    @InjectQueue('anomaly-scan') private readonly anomalyQueue: Queue,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  /**
   * Enqueues a scan for the current tenant.
   * Pulls tenantId from context to put it into the job payload.
   */
  async enqueueScan(): Promise<{ jobId: string | number }> {
    const { tenantId } = getTenantContext();
    if (!tenantId) throw new UnauthorizedException('Tenant context required');

    const job = await this.anomalyQueue.add('run-scan', { tenantId });
    return { jobId: job.id };
  }

  async listAnomalies(types?: AnomalyType[], minScore?: number): Promise<PersistedAnomaly[]> {
    return this.repo.list(types, minScore);
  }

  async getAnomaly(id: string): Promise<PersistedAnomaly | null> {
    return this.repo.findById(id);
  }

  /**
   * Entry point for the Queue Processor.
   * Background tasks must manually establish the context via runInTenantContext.
   */
  async runScanForTenant(tenantId: string): Promise<void> {
    await this.repo.runInTenantContext(tenantId, async () => {
      this.logger.log(`Anomaly scan start — tenant ${tenantId}`);

      // These private methods now run inside the search_path of the tenant
      await Promise.all([this.runExpenseSpikeDetection(), this.runDuplicateInvoiceDetection()]);

      this.logger.log(`Anomaly scan complete — tenant ${tenantId}`);
    });
  }

  private async runExpenseSpikeDetection(): Promise<void> {
    // Analytics repository will now use the search_path set by runInTenantContext
    const vendorSpends = await this.analytics.getVendorSpendHistory(null, 6);
    const { tenantId } = getTenantContext();

    const spikes = this.detector.detectExpenseSpikes(tenantId!, vendorSpends as VendorSpend[]);
    for (const spike of spikes) await this.persistAndNotify(spike);
  }

  private async runDuplicateInvoiceDetection(): Promise<void> {
    const candidates = await this.repo.getDuplicateCandidates();
    const { tenantId } = getTenantContext();

    const duplicates = this.detector.detectDuplicateInvoices(tenantId!, candidates);
    for (const dup of duplicates) await this.persistAndNotify(dup);
  }

  private async persistAndNotify(candidate: AnomalyCandidate): Promise<void> {
    const { tenantId } = getTenantContext();
    const saved = await this.repo.save(candidate);

    void this.audit
      .log({
        tenantId: tenantId!,
        userId: null,
        action: AuditAction.WRITE,
        resourceType: 'anomaly',
        resourceId: saved.id,
        metadata: { type: saved.type, score: saved.score, explanation: saved.explanation },
        ...systemAuditMeta(),
      })
      .catch(() => {});

    if (saved.score >= HIGH_CONFIDENCE_THRESHOLD) {
      await this.pubSub.publish('ANOMALY_RAISED', { anomalyRaised: saved });
    }
  }
}
