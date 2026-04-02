// src/reports/reports.controller.ts
//
// REST endpoints for the Reports + Exports module.
//
// Routes:
//   POST   /api/reports/schedules          — create a report schedule
//   GET    /api/reports/schedules          — list all schedules
//   PUT    /api/reports/schedules/:id      — update a schedule
//   DELETE /api/reports/schedules/:id      — deactivate a schedule
//   POST   /api/reports/generate           — generate + download on demand
//   GET    /api/reports/exports            — list export audit logs
//   GET    /api/reports/download/:token    — public download endpoint (no auth — link IS the auth)

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Req,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { FeatureFlagService } from '@subscription/feature-flag.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { ReportGeneratorService } from './report-generator.service';
import { ExportService } from './export.service';
import { CronHelperService } from './cron-helper.service';
import {
  CreateReportScheduleDto,
  UpdateReportScheduleDto,
  ReportFormat,
  ReportSection,
} from './reports.types';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
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

  private static readonly UPDATE_SCHEDULE_SQL = `
    UPDATE report_schedules SET
      name        = COALESCE($1, name),
      cron        = COALESCE($2, cron),
      timezone    = COALESCE($3, timezone),
      format      = COALESCE($4, format),
      recipients  = COALESCE($5, recipients),
      sections    = COALESCE($6, sections),
      is_active   = COALESCE($7, is_active),
      next_run_at = COALESCE($8, next_run_at),
      updated_at  = NOW()
    WHERE id = $9
    RETURNING
      id, name, cron, timezone, format, recipients, sections,
      is_active AS "isActive", last_run_at AS "lastRunAt",
      next_run_at AS "nextRunAt", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
  `;

  private static readonly DEACTIVATE_SCHEDULE_SQL = `
    UPDATE report_schedules SET is_active = false, updated_at = NOW() WHERE id = $1
  `;

  constructor(
    private readonly generator: ReportGeneratorService,
    private readonly exportService: ExportService,
    private readonly cronHelper: CronHelperService,
    private readonly featureFlags: FeatureFlagService,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  // ── POST /api/reports/schedules ───────────────────────────────────────────

  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async createSchedule(@Body() dto: CreateReportScheduleDto) {
    const ctx = await this.ctx();
    await this.featureFlags.checkAndIncrement(ctx.tenantId!, 'scheduled_reports').catch((err) => {
      if (err?.status === 403) throw err;
    });

    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    if (!dto.recipients?.length)
      throw new BadRequestException('at least one recipient is required');
    if (!dto.format) throw new BadRequestException('format is required');

    const cron = this.cronHelper.resolve(dto);
    const timezone = dto.timezone ?? 'UTC';
    const sections = dto.sections ?? ['finance', 'hr', 'ops'];
    const nextRun = this.cronHelper.nextRunAfter(cron, new Date(), timezone);

    const rows = await this.tenantDb.executeTenant(ReportsController.INSERT_SCHEDULE_SQL, [
      dto.name,
      cron,
      timezone,
      dto.format,
      dto.recipients,
      sections,
      nextRun.toISOString(),
      ctx.userId,
    ]);
    return rows[0];
  }

  // ── GET /api/reports/schedules ────────────────────────────────────────────

  @Get('schedules')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async listSchedules() {
    const ctx = await this.ctx();
    await this.featureFlags.checkAndIncrement(ctx.tenantId!, 'scheduled_reports').catch((err) => {
      if (err?.status === 403) throw err;
    });
    return this.tenantDb.executeTenant(ReportsController.LIST_SCHEDULES_SQL);
  }

  // ── PUT /api/reports/schedules/:id ────────────────────────────────────────

  @Put('schedules/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async updateSchedule(@Param('id') id: string, @Body() dto: UpdateReportScheduleDto) {
    const ctx = await this.ctx();
    await this.featureFlags.checkAndIncrement(ctx.tenantId!, 'scheduled_reports').catch((err) => {
      if (err?.status === 403) throw err;
    });

    // Recompute cron + next_run_at only if schedule-related fields changed
    let newCron: string | null = null;
    let newNextRun: string | null = null;

    if (dto.cron || dto.interval) {
      newCron = this.cronHelper.resolve(dto);
      newNextRun = this.cronHelper
        .nextRunAfter(newCron, new Date(), dto.timezone ?? 'UTC')
        .toISOString();
    }

    const rows = await this.tenantDb.executeTenant(ReportsController.UPDATE_SCHEDULE_SQL, [
      dto.name ?? null,
      newCron,
      dto.timezone ?? null,
      dto.format ?? null,
      dto.recipients ?? null,
      dto.sections ?? null,
      dto.isActive ?? null,
      newNextRun,
      id,
    ]);

    if (!rows[0]) throw new BadRequestException(`Schedule ${id} not found`);
    return rows[0];
  }

  // ── DELETE /api/reports/schedules/:id ─────────────────────────────────────

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async deleteSchedule(@Param('id') id: string) {
    const ctx = await this.ctx();
    if (!ctx.tenantId) throw new BadRequestException('Tenant context required');
    await this.featureFlags.checkAndIncrement(ctx.tenantId, 'scheduled_reports').catch((err) => {
      if (err?.status === 403) throw err;
    });
    await this.tenantDb.executeTenant(ReportsController.DEACTIVATE_SCHEDULE_SQL, [id]);
  }

  // ── POST /api/reports/generate ────────────────────────────────────────────
  // On-demand report — generates immediately and returns the file as a download

  @Post('generate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async generateNow(
    @Body()
    body: {
      name?: string;
      format: ReportFormat;
      sections?: ReportSection[];
    },
    @Res() res: Response,
  ) {
    const ctx = await this.ctx();
    if (!ctx.tenantId) throw new BadRequestException('Tenant context required');
    await this.checkFeature(ctx.tenantId);

    if (!body.format) throw new BadRequestException('format is required');

    const reportName = body.name ?? 'On-Demand Report';
    const sections = body.sections ?? ['finance', 'hr', 'ops'];

    const data = await this.generator.assembleReportData(ctx.tenantId, sections, reportName);
    const buffer = await this.generator.render(data, body.format);

    // Also create a secure export link for later re-download
    const exportLog = await this.exportService.createExport(
      buffer,
      body.format,
      reportName,
      ctx.userId ?? 'unknown',
    );

    res.setHeader('Content-Type', this.contentType(body.format));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportName.replace(/\s+/g, '-')}.${body.format}"`,
    );
    res.setHeader('X-Export-Token', exportLog.secureToken);
    res.setHeader('X-Export-Expires', exportLog.expiresAt);
    res.send(buffer);
  }

  // ── GET /api/reports/exports ──────────────────────────────────────────────

  @Get('exports')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async listExports(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const ctx = await this.ctx();
    if (!ctx.tenantId) throw new BadRequestException('User context required');
    await this.checkFeature(ctx.tenantId);
    return this.exportService.listExports(limit, offset);
  }

  // ── GET /api/reports/download/:token ──────────────────────────────────────
  // NO auth guard — the token IS the credential (same as email link)

  @Get('download/:token')
  async download(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const { buffer, format, reportName } = await this.exportService.downloadByToken(token, ip);

    res.setHeader('Content-Type', this.contentType(format));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportName.replace(/\s+/g, '-')}.${format}"`,
    );
    res.send(buffer);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ctx() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    return ctx;
  }

  private async checkFeature(tenantId: string): Promise<void> {
    await this.featureFlags.checkAndIncrement(tenantId, 'exports').catch((err) => {
      if (err?.status === 403) throw err;
    });
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
