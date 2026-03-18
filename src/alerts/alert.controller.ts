// src/alerts/alert.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { AlertRuleService } from './alert-rule.service';
import { AlertEventService } from './alert-event.service';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import {
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
  AlertRuleFilters,
  AlertEventFilters,
  AlertMetric,
  AlertSeverity,
  AlertStatus,
} from './alert.types';

@ApiTags('Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('alerts')
export class AlertController {
  constructor(
    private readonly ruleService: AlertRuleService,
    private readonly eventService: AlertEventService,
    private readonly evaluator: AlertEvaluatorService, // ← add
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  // ── Alert Rules ────────────────────────────────────────────────────────────

  // POST /api/alerts/rules
  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  async createRule(@Body() dto: CreateAlertRuleDto) {
    const ctx = this.ctx();
    if (!ctx.tenantId) throw new BadRequestException('User context required');
    return this.ruleService.create(dto, ctx.userId ?? 'unknown', ctx.tenantId);
  }

  // GET /api/alerts/rules?metric=cash_balance&severity=critical&isActive=true
  @Get('rules')
  async listRules(
    @Query('metric') metric?: AlertMetric,
    @Query('severity') severity?: AlertSeverity,
    @Query('isActive') isActive?: string,
  ) {
    const filters: AlertRuleFilters = {
      metric,
      severity,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    };
    return this.ruleService.list(filters);
  }

  // GET /api/alerts/rules/:id
  @Get('rules/:id')
  async getRule(@Param('id') id: string) {
    return this.ruleService.findById(id);
  }

  // PUT /api/alerts/rules/:id
  @Put('rules/:id')
  async updateRule(@Param('id') id: string, @Body() dto: UpdateAlertRuleDto) {
    return this.ruleService.update(id, dto);
  }

  // DELETE /api/alerts/rules/:id
  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(@Param('id') id: string) {
    return this.ruleService.delete(id);
  }

  // ── Alert Events ───────────────────────────────────────────────────────────

  // GET /api/alerts/events?status=open&severity=critical&from=2026-01-01&to=2026-03-31
  @Get('events')
  async listEvents(
    @Query('status') status?: AlertStatus,
    @Query('severity') severity?: AlertSeverity,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: AlertEventFilters = {
      status,
      severity,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    };
    return this.eventService.list(filters);
  }

  // GET /api/alerts/events/open  — convenience endpoint for dashboard badges
  @Get('events/open')
  async openEvents() {
    return this.eventService.openAlerts();
  }

  // GET /api/alerts/events/:id
  @Get('events/:id')
  async getEvent(@Param('id') id: string) {
    return this.eventService.findById(id);
  }

  // POST /api/alerts/events/:id/acknowledge
  @Post('events/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  async acknowledgeEvent(@Param('id') id: string) {
    const ctx = this.ctx();
    return this.eventService.acknowledge(id, ctx.userId ?? 'unknown');
  }

  // POST /api/alerts/events/:id/resolve
  @Post('events/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveEvent(@Param('id') id: string) {
    return this.eventService.resolve(id);
  }

  @Post('evaluate')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerEvaluation() {
    const ctx = this.ctx();
    const rows = await this.tenantDb.executePublic<{ schema_name: string }>(
      `SELECT schema_name FROM public.tenants WHERE id = $1`,
      [ctx.tenantId],
    );
    const TenantId = ctx.tenantId;
    if (!TenantId) throw new BadRequestException('Tenant context required');
    await this.evaluator.evaluateForTenant(TenantId, rows[0].schema_name);
    return { message: 'Evaluation triggered' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private ctx() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    return ctx;
  }
}
