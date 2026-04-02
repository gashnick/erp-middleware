// src/reports/report-scheduler.service.ts
//
// Runs every minute via @Cron, queries report_schedules for any reports
// whose next_run_at is due, generates them, delivers via email + WhatsApp
// (WhatsApp is a placeholder until Stream 6), and updates next_run_at.
//
// Bull workers cannot use AsyncLocalStorage — tenant context must be
// restored explicitly via runWithTenantContext() in each job.
//
// Scheduler design:
//   - Queries ALL tenants' due schedules from public.tenants + tenant schemas
//   - Processes each tenant's due schedules sequentially within each tenant
//   - A failed report for one tenant never blocks other tenants
//   - next_run_at is computed by CronHelperService.nextRunAfter()

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { runWithTenantContext } from '@common/context/tenant-context';
import { CronHelperService } from './cron-helper.service';
import { ReportGeneratorService } from './report-generator.service';
import { ExportService } from './export.service';
import { EmailService } from './email.service';
import { ReportFormat, ReportSection } from './reports.types';

interface DueSchedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  format: ReportFormat;
  recipients: string[];
  sections: ReportSection[];
}

@Injectable()
export class ReportSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReportSchedulerService.name);

  private static readonly DUE_SCHEDULES_SQL = `
    SELECT
      id, name, cron, timezone, format,
      recipients, sections
    FROM report_schedules
    WHERE is_active = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
    LIMIT 50
  `;

  private static readonly UPDATE_NEXT_RUN_SQL = `
    UPDATE report_schedules
    SET last_run_at = NOW(),
        next_run_at = $1,
        updated_at  = NOW()
    WHERE id = $2
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly cronHelper: CronHelperService,
    private readonly generator: ReportGeneratorService,
    private readonly exportService: ExportService,
    private readonly emailService: EmailService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Verify SMTP on startup so misconfiguration is caught early
    await this.emailService.verifyConnection();
    this.logger.log('ReportSchedulerService initialised');
  }

  /**
   * Runs every minute.
   * Fetches all active tenants, then for each tenant checks if any
   * report_schedules are due and processes them.
   */
  @Cron('* * * * *')
  async runDueReports(): Promise<void> {
    // Evict stale export buffers from memory on each tick
    this.exportService.evictExpired();

    let tenants: Array<{ id: string; schemaName: string }>;
    try {
      tenants = await this.tenantDb.executePublic<{ id: string; schemaName: string }>(
        `SELECT id, schema_name AS "schemaName"
         FROM public.tenants
         WHERE status = 'active'`,
      );
    } catch (err) {
      this.logger.error(`Failed to fetch active tenants: ${err.message}`);
      return;
    }

    for (const tenant of tenants) {
      try {
        await this.processSchedulesForTenant(tenant.id, tenant.schemaName);
      } catch (err) {
        // One tenant failing never blocks others
        this.logger.error(`Scheduler error for tenant ${tenant.id}: ${err.message}`);
      }
    }
  }

  /**
   * Processes all due report schedules for a single tenant.
   * Runs inside tenant context so all DB queries hit the correct schema.
   */
  private async processSchedulesForTenant(tenantId: string, schemaName: string): Promise<void> {
    await runWithTenantContext(
      { tenantId, schemaName, userId: 'system-scheduler', userRole: 'SYSTEM' },
      async () => {
        const dueSchedules = await this.tenantDb.executeTenant<DueSchedule>(
          ReportSchedulerService.DUE_SCHEDULES_SQL,
        );

        if (dueSchedules.length === 0) return;

        this.logger.log(`Processing ${dueSchedules.length} due report(s) for tenant ${tenantId}`);

        for (const schedule of dueSchedules) {
          await this.runSchedule(schedule, tenantId);
        }
      },
    );
  }

  /**
   * Generates, stores, and delivers a single report schedule.
   * Updates next_run_at regardless of delivery success.
   */
  private async runSchedule(schedule: DueSchedule, tenantId: string): Promise<void> {
    this.logger.log(`Running report "${schedule.name}" [${schedule.id}] for tenant ${tenantId}`);

    try {
      // 1. Assemble data from Finance + HR + Ops
      const data = await this.generator.assembleReportData(
        tenantId,
        schedule.sections,
        schedule.name,
      );

      // 2. Render to requested format
      const buffer = await this.generator.render(data, schedule.format);

      // 3. Store as secure export (24h link)
      const exportLog = await this.exportService.createExport(
        buffer,
        schedule.format,
        schedule.name,
        'system-scheduler',
      );

      const downloadUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/api/reports/download/${exportLog.secureToken}`;

      // 4. Send email
      if (schedule.recipients.length > 0) {
        const subject = `${schedule.name} — ${data.periodLabel}`;
        const emailHtml = this.buildEmailHtml(
          schedule.name,
          data.periodLabel,
          downloadUrl,
          schedule.format,
        );

        const emailResult = await this.emailService.sendReport({
          to: schedule.recipients,
          subject,
          html: emailHtml,
          attachments: [
            {
              filename: `${schedule.name.replace(/\s+/g, '-')}.${schedule.format}`,
              content: buffer,
              contentType: this.contentType(schedule.format),
            },
          ],
        });

        if (!emailResult.success) {
          this.logger.warn(
            `Email delivery failed for schedule ${schedule.id}: ${emailResult.error}`,
          );
        }
      }

      // 5. WhatsApp placeholder — Stream 6 will replace this
      this.logger.debug(
        `[WhatsApp placeholder] Would send report "${schedule.name}" ` +
          `to ${schedule.recipients.length} recipient(s) via WhatsApp`,
      );
    } catch (err) {
      this.logger.error(`Report generation failed for schedule ${schedule.id}: ${err.message}`);
      // Still update next_run_at so we don't retry immediately on the next minute
    } finally {
      // Always advance next_run_at — even if generation failed
      const nextRun = this.cronHelper.nextRunAfter(schedule.cron, new Date(), schedule.timezone);

      await this.tenantDb
        .executeTenant(ReportSchedulerService.UPDATE_NEXT_RUN_SQL, [
          nextRun.toISOString(),
          schedule.id,
        ])
        .catch((err) =>
          this.logger.error(
            `Failed to update next_run_at for schedule ${schedule.id}: ${err.message}`,
          ),
        );

      this.logger.log(`Schedule "${schedule.name}" next run: ${nextRun.toISOString()}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildEmailHtml(
    reportName: string,
    period: string,
    downloadUrl: string,
    format: ReportFormat,
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #4f46e5; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">${reportName}</h1>
          <p style="color: #c7d2fe; margin: 4px 0 0;">${period}</p>
        </div>
        <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 8px 8px;">
          <p style="color: #374151;">Your scheduled report is ready.</p>
          <p>
            <a href="${downloadUrl}"
               style="background: #4f46e5; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; display: inline-block;">
              Download ${format.toUpperCase()}
            </a>
          </p>
          <p style="color: #9ca3af; font-size: 12px;">
            This link expires in 24 hours. Do not forward this email.
          </p>
        </div>
        <p style="color: #d1d5db; font-size: 11px; text-align: center; margin-top: 16px;">
          Generated by CID ERP &mdash; Confidential
        </p>
      </div>
    `;
  }

  private contentType(format: ReportFormat): string {
    switch (format) {
      case 'pdf':
        return 'application/pdf';
      case 'csv':
        return 'text/csv';
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
  }
}
