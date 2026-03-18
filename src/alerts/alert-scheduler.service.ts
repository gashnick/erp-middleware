// src/alerts/alert-scheduler.service.ts
//
// Schedules alert evaluation to run every 5 minutes across all active tenants.
// Uses @nestjs/schedule @Cron decorator — NestJS calls this automatically.
//
// Why not a Bull repeat job:
//   Bull repeat jobs run once per queue regardless of number of tenants.
//   The cron here runs once and fans out — enqueuing one Bull job per tenant.
//   This way evaluation is parallelized across Bull workers, not sequential.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertEvaluatorService } from './alert-evaluator.service';

@Injectable()
export class AlertSchedulerService {
  private readonly logger = new Logger(AlertSchedulerService.name);

  constructor(private readonly evaluator: AlertEvaluatorService) {}

  // Runs every 5 minutes
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runEvaluation(): Promise<void> {
    this.logger.debug('Alert evaluation cycle starting');
    try {
      await this.evaluator.enqueueForAllTenants();
    } catch (err) {
      // Never let scheduler crash — log and continue
      this.logger.error(`Alert evaluation cycle failed: ${err.message}`);
    }
  }
}
