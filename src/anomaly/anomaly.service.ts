// src/anomaly/anomaly.service.ts
//
// Passes schemaName explicitly through every DB call during background scans.
// This bypasses AsyncLocalStorage which does not propagate through Bull workers.

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
const VENDOR_LOOKBACK_MONTHS = 6;

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

  // ── Public API ─────────────────────────────────────────────────────────────

  async enqueueScan(): Promise<{ jobId: string | number }> {
    const { tenantId, schemaName } = getTenantContext();
    if (!tenantId) throw new UnauthorizedException('Tenant context required');

    this.logger.log(`Enqueuing anomaly scan for tenant ${tenantId} (${schemaName})`);

    const job = await this.anomalyQueue.add(
      'run-scan',
      { tenantId, schemaName },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return { jobId: job.id };
  }

  async listAnomalies(types?: AnomalyType[], minScore?: number): Promise<PersistedAnomaly[]> {
    return this.repo.list(types, minScore);
  }

  async getAnomaly(id: string): Promise<PersistedAnomaly | null> {
    return this.repo.findById(id);
  }

  /**
   * Called by the queue processor. schemaName is passed explicitly through
   * every DB call — we cannot rely on AsyncLocalStorage in Bull workers.
   */
  async runScanForTenant(tenantId: string, schemaName: string): Promise<void> {
    this.logger.log(`Anomaly scan started — tenant ${tenantId} | schema ${schemaName}`);

    const results = await Promise.allSettled([
      this.runExpenseSpikeDetection(tenantId, schemaName),
      this.runDuplicateInvoiceDetection(tenantId, schemaName),
      this.runUnusualPaymentDetection(tenantId, schemaName),
    ]);

    let succeeded = 0;
    const labels = ['ExpenseSpike', 'DuplicateInvoice', 'UnusualPayment'];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        succeeded++;
      } else {
        this.logger.error(`${labels[i]} detection failed: ${result.reason?.message}`);
      }
    }

    this.logger.log(
      `Anomaly scan complete — tenant ${tenantId} | ${succeeded}/3 detectors succeeded`,
    );
  }

  // ── Private detectors ──────────────────────────────────────────────────────

  private async runExpenseSpikeDetection(tenantId: string, schemaName: string): Promise<void> {
    // Pass schemaName explicitly — AnalyticsRepository.getVendorSpendHistory
    // needs to know which tenant schema to query
    const vendorSpends = await this.analytics.getVendorSpendHistory(
      null,
      VENDOR_LOOKBACK_MONTHS,
      schemaName,
    );

    const spikes = this.detector.detectExpenseSpikes(tenantId, vendorSpends as VendorSpend[]);

    this.logger.debug(`ExpenseSpike: ${spikes.length} anomalies detected`);
    this.logger.debug(`Raw scores: ${spikes.map((s) => `${s.score}|${s.confidence}`).join(', ')}`);
    for (const spike of spikes) await this.persistAndNotify(spike, tenantId, schemaName);
  }

  private async runDuplicateInvoiceDetection(tenantId: string, schemaName: string): Promise<void> {
    const candidates = await this.repo.getDuplicateCandidates(schemaName);
    const duplicates = this.detector.detectDuplicateInvoices(tenantId, candidates);

    this.logger.debug(`DuplicateInvoice: ${duplicates.length} anomalies detected`);
    for (const dup of duplicates) await this.persistAndNotify(dup, tenantId, schemaName);
  }

  private async runUnusualPaymentDetection(tenantId: string, schemaName: string): Promise<void> {
    const payments = await this.repo.getPaymentRecords(schemaName);
    const unusual = this.detector.detectUnusualPayments(tenantId, payments);

    this.logger.debug(`UnusualPayment: ${unusual.length} anomalies detected`);
    for (const payment of unusual) await this.persistAndNotify(payment, tenantId, schemaName);
  }

  // ── Persistence & notification ─────────────────────────────────────────────

  private async persistAndNotify(
    candidate: AnomalyCandidate,
    tenantId: string,
    schemaName: string,
  ): Promise<void> {
    const saved = await this.repo.save(candidate, schemaName);

    if (!saved) {
      this.logger.debug(`Skipped duplicate anomaly: ${candidate.type} ${candidate.relatedIds}`);
      return;
    }

    void this.audit
      .log({
        tenantId,
        userId: null,
        action: AuditAction.WRITE,
        resourceType: 'anomaly',
        resourceId: saved.id,
        metadata: { type: saved.type, score: saved.score, explanation: saved.explanation },
        ...systemAuditMeta(),
      })
      .catch((err) => this.logger.warn(`Audit log failed: ${err.message}`));

    if (saved.score >= HIGH_CONFIDENCE_THRESHOLD) {
      await this.pubSub
        .publish('ANOMALY_RAISED', { anomalyRaised: saved })
        .catch((err) => this.logger.warn(`PubSub publish failed: ${err.message}`));
    }
  }
}
