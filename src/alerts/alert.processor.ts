// src/alerts/alert.processor.ts
//
// Bull job processor for the 'alert-evaluation' queue.
// Two job types:
//   'evaluate' — runs AlertEvaluatorService for a specific tenant
//   'notify'   — sends notifications for a triggered alert event
//
// Same pattern as AnomalyScanProcessor — establishes AsyncLocalStorage
// tenant context before any DB call so search_path is set correctly.

import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertNotifierService } from './alert-notifier.service';
import { tenantContext, TenantContext, UserRole } from '@common/context/tenant-context';
import { AlertSeverity, AlertChannel } from './alert.types';

interface EvaluateJobPayload {
  tenantId: string;
  schemaName: string;
}

interface NotifyJobPayload {
  ruleId: string;
  ruleName: string;
  metric: string;
  actualValue: number;
  threshold: number;
  severity: AlertSeverity;
  channels: AlertChannel[];
  tenantId: string;
}

@Processor('alert-evaluation')
export class AlertProcessor {
  private readonly logger = new Logger(AlertProcessor.name);

  constructor(
    private readonly evaluator: AlertEvaluatorService,
    private readonly notifier: AlertNotifierService,
  ) {}

  @Process('evaluate')
  async handleEvaluate(job: Job<EvaluateJobPayload>): Promise<void> {
    const { tenantId, schemaName } = job.data;

    const ctx: TenantContext = {
      tenantId,
      schemaName,
      userId: 'system-alert-evaluator',
      userEmail: '',
      userRole: UserRole.SYSTEM_JOB,
      requestId: `alert-eval-${job.id}-${Date.now()}`,
      timestamp: new Date(),
    };

    await tenantContext.run(ctx, () => this.evaluator.evaluateForTenant(tenantId, schemaName));
  }

  @Process('notify')
  async handleNotify(job: Job<NotifyJobPayload>): Promise<void> {
    const { tenantId, schemaName, ...alertData } = job.data as any;

    const ctx: TenantContext = {
      tenantId,
      schemaName: schemaName ?? tenantId, // fallback
      userId: 'system-alert-notifier',
      userEmail: '',
      userRole: UserRole.SYSTEM_JOB,
      requestId: `alert-notify-${job.id}-${Date.now()}`,
      timestamp: new Date(),
    };

    await tenantContext.run(ctx, () => this.notifier.notify(job.data));
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(`Alert job '${job.name}' ${job.id} failed: ${error.message}`, error.stack);
  }
}
