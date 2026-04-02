// src/reports/reports.resolver.ts
//
// GraphQL resolver for the Reports module.
// Matches the HR/Ops resolver pattern exactly.
//
// Queries:
//   reportSchedules   — list all active schedules
//   exportLogs        — audit log of downloads
//
// Mutations:
//   createReportSchedule(input) — create a schedule
//   generateReport(format, sections) — on-demand, returns secureToken

import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { runWithTenantContext } from '@common/context/tenant-context';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { FeatureFlagService } from '@subscription/feature-flag.service';
import { ReportGeneratorService } from './report-generator.service';
import { ExportService } from './export.service';
import { CronHelperService } from './cron-helper.service';
import { ReportFormat, ReportSection } from './reports.types';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class ReportsResolver {
  private static readonly LIST_SCHEDULES_SQL = `
    SELECT
      id, name, cron, timezone, format, recipients, sections,
      is_active AS "isActive", last_run_at AS "lastRunAt",
      next_run_at AS "nextRunAt", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM report_schedules
    WHERE is_active = true
    ORDER BY created_at DESC
  `;

  private static readonly INSERT_SCHEDULE_SQL = `
    INSERT INTO report_schedules
      (name, cron, timezone, format, recipients, sections, is_active, next_run_at, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
    RETURNING
      id, name, cron, timezone, format, recipients, sections,
      is_active AS "isActive", last_run_at AS "lastRunAt",
      next_run_at AS "nextRunAt", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly generator: ReportGeneratorService,
    private readonly exportService: ExportService,
    private readonly cronHelper: CronHelperService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => String, { name: 'reportSchedules' })
  async reportSchedules(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    await this.featureFlags.checkAndIncrement(user.tenantId, 'scheduled_reports').catch((e) => {
      if (e?.status === 403) throw e;
    });
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () =>
        JSON.stringify(await this.tenantDb.executeTenant(ReportsResolver.LIST_SCHEDULES_SQL)),
    );
  }

  @Query(() => String, { name: 'exportLogs' })
  async exportLogs(
    @Args('limit', { nullable: true, defaultValue: 20 }) limit: number,
    @Args('offset', { nullable: true, defaultValue: 0 }) offset: number,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    await this.featureFlags.checkAndIncrement(user.tenantId, 'exports').catch((e) => {
      if (e?.status === 403) throw e;
    });
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.exportService.listExports(limit, offset)),
    );
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  @Mutation(() => String, { name: 'createReportSchedule' })
  async createReportSchedule(
    @Args('name') name: string,
    @Args('format') format: string,
    @Args('recipients', { type: () => [String] }) recipients: string[],
    @Args('cron', { nullable: true }) cron?: string,
    @Args('interval', { nullable: true }) interval?: string,
    @Args('hour', { nullable: true }) hour?: number,
    @Args('dayOfWeek', { nullable: true }) dayOfWeek?: number,
    @Args('dayOfMonth', { nullable: true }) dayOfMonth?: number,
    @Args('timezone', { nullable: true }) timezone?: string,
    @Args('sections', { nullable: true, type: () => [String] }) sections?: string[],
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    await this.featureFlags.checkAndIncrement(user.tenantId, 'scheduled_reports').catch((e) => {
      if (e?.status === 403) throw e;
    });

    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const resolvedCron = this.cronHelper.resolve({
          cron,
          interval: interval as any,
          hour,
          dayOfWeek,
          dayOfMonth,
        });
        const tz = timezone ?? 'UTC';
        const nextRun = this.cronHelper.nextRunAfter(resolvedCron, new Date(), tz);

        const rows = await this.tenantDb.executeTenant(ReportsResolver.INSERT_SCHEDULE_SQL, [
          name,
          resolvedCron,
          tz,
          format,
          recipients,
          sections ?? ['finance', 'hr', 'ops'],
          nextRun.toISOString(),
          user.id,
        ]);
        return JSON.stringify(rows[0]);
      },
    );
  }

  @Mutation(() => String, { name: 'generateReport' })
  async generateReport(
    @Args('format') format: string,
    @Args('sections', { nullable: true, type: () => [String] }) sections?: string[],
    @Args('name', { nullable: true }) name?: string,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    await this.featureFlags.checkAndIncrement(user.tenantId, 'exports').catch((e) => {
      if (e?.status === 403) throw e;
    });

    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const reportName = name ?? 'On-Demand Report';
        const reportSections = (sections ?? ['finance', 'hr', 'ops']) as ReportSection[];
        const data = await this.generator.assembleReportData(
          user.tenantId,
          reportSections,
          reportName,
        );
        const buffer = await this.generator.render(data, format as ReportFormat);
        const exportLog = await this.exportService.createExport(
          buffer,
          format as ReportFormat,
          reportName,
          user.id,
        );
        return JSON.stringify({
          secureToken: exportLog.secureToken,
          expiresAt: exportLog.expiresAt,
          downloadUrl: `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/api/reports/download/${exportLog.secureToken}`,
        });
      },
    );
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private getUser(ctx: GraphQLContext | undefined) {
    const user = ctx?.req?.user;
    if (!user) throw new BadRequestException('Unauthorized');
    return user;
  }
}
