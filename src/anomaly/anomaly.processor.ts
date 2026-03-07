// src/anomaly/anomaly.processor.ts
//
// Bull queue processor for the 'anomaly-scan' queue.
//
// Responsibility: consume 'run-scan' jobs and delegate to AnomalyService.
// This is the only class that touches Bull job lifecycle (progress, completion,
// failure). Business logic stays in AnomalyService — this is pure plumbing.
//
// Why a queue instead of a direct call?
//   Anomaly scans can take several seconds per tenant. A queue decouples the
//   HTTP response (instant job ID) from the actual scan work, preventing
//   request timeouts and allowing retries on failure.

import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AnomalyService } from './anomaly.service';

interface ScanJobPayload {
  tenantId: string;
  schemaName: string;
}

@Processor('anomaly-scan')
export class AnomalyProcessor {
  private readonly logger = new Logger(AnomalyProcessor.name);

  constructor(private readonly anomalyService: AnomalyService) {}

  @Process('run-scan')
  async handleScan(job: Job<ScanJobPayload>): Promise<void> {
    const { tenantId, schemaName } = job.data;

    if (!tenantId || !schemaName) {
      throw new Error(`Invalid job payload — tenantId and schemaName are required`);
    }

    this.logger.log(`Processing scan job ${job.id} for tenant ${tenantId}`);

    await job.progress(10);
    await this.anomalyService.runScanForTenant(tenantId, schemaName);
    await job.progress(100);
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
}
