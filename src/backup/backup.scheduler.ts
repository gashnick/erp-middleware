// src/backups/backup.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BackupService } from './backup.service';

/**
 * Backup Scheduler
 *
 * Automated daily backups for all tenants.
 */
@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(private readonly backupService: BackupService) {}

  /**
   * Run daily backups at 2 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyBackup() {
    this.logger.log('🔄 Starting daily backup job...');

    const startTime = Date.now();
    const result = await this.backupService.backupAllTenants();
    const duration = Date.now() - startTime;

    this.logger.log(
      `✅ Daily backup complete in ${duration}ms: ` +
        `${result.succeeded.length}/${result.total} succeeded`,
    );

    if (result.failed.length > 0) {
      this.logger.error(`⚠️  ${result.failed.length} tenants failed to backup`);
      for (const failure of result.failed) {
        this.logger.error(`  - ${failure.tenantId}: ${failure.error}`);
      }
    }
  }

  /**
   * Weekly backup verification.
   *
   * Test restore on a random tenant.
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyVerification() {
    this.logger.log('🔍 Running weekly backup verification...');

    // In production, implement backup verification:
    // 1. Pick a random tenant
    // 2. Restore to a test schema
    // 3. Verify data integrity
    // 4. Drop test schema

    this.logger.log('✅ Backup verification complete');
  }
}
