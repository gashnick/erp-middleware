// src/ops/ops-dashboard.controller.ts
//
// REST endpoints for the Operations Dashboard.
//
// All endpoints are:
//   - Protected by JwtAuthGuard + TenantGuard
//   - Feature-gated behind 'ops_dashboard' via FeatureFlagService.checkAndIncrement()
//   - Tenant context resolved via the private ctx() helper
//
// Routes (baseUrl = http://localhost:3000/api):
//   GET  /api/ops/inventory/summary    — asset counts by status + category
//   GET  /api/ops/assets               — paginated asset list with filters
//   GET  /api/ops/orders/pipeline      — orders grouped by status + channel
//   GET  /api/ops/sla/status           — all active SLAs with actual vs target
//   GET  /api/ops/sla/breaches         — breached SLAs only
//   POST /api/ops/sla/configs          — create a new SLA rule

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { FeatureFlagService } from '@subscription/feature-flag.service';
import { OpsDashboardService } from './ops-dashboard.service';
import { CreateSlaConfigDto, AssetStatus } from './ops.types';

@ApiTags('Ops Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('ops')
export class OpsDashboardController {
  constructor(
    private readonly opsService: OpsDashboardService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ── GET /api/ops/inventory/summary ────────────────────────────────────────

  @Get('inventory/summary')
  async inventorySummary() {
    await this.checkFeature();
    return this.opsService.inventorySummary();
  }

  // ── GET /api/ops/assets ───────────────────────────────────────────────────

  @Get('assets')
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['operational', 'maintenance', 'offline', 'retired'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  async assetStatus(
    @Query('category') category?: string,
    @Query('status') status?: AssetStatus,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number = 0,
  ) {
    await this.checkFeature();

    if (limit < 1 || limit > 200) {
      throw new BadRequestException('limit must be between 1 and 200');
    }

    return this.opsService.assetStatus({ category, status, limit, offset });
  }

  // ── GET /api/ops/orders/pipeline ──────────────────────────────────────────

  @Get('orders/pipeline')
  async ordersPipeline() {
    await this.checkFeature();
    return this.opsService.ordersPipeline();
  }

  // ── GET /api/ops/sla/status ───────────────────────────────────────────────
  // NOTE: must be declared before sla/breaches would be if we used params,
  // but both are literal paths so order doesn't matter here.

  @Get('sla/status')
  async slaStatus() {
    await this.checkFeature();
    return this.opsService.slaStatus();
  }

  // ── GET /api/ops/sla/breaches ─────────────────────────────────────────────

  @Get('sla/breaches')
  async slaBreaches() {
    await this.checkFeature();
    return this.opsService.slaBreaches();
  }

  // ── POST /api/ops/sla/configs ─────────────────────────────────────────────

  @Post('sla/configs')
  @HttpCode(HttpStatus.CREATED)
  async createSlaConfig(@Body() dto: CreateSlaConfigDto) {
    await this.checkFeature();

    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    if (!dto.metric?.trim()) throw new BadRequestException('metric is required');
    if (dto.targetValue == null || dto.targetValue <= 0) {
      throw new BadRequestException('targetValue must be a positive number');
    }
    if (dto.warningPct !== undefined && (dto.warningPct < 1 || dto.warningPct > 100)) {
      throw new BadRequestException('warningPct must be between 1 and 100');
    }

    return this.opsService.createSlaConfig(dto);
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private async checkFeature(): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    await this.featureFlags.checkAndIncrement(ctx.tenantId, 'ops_dashboard').catch((err) => {
      if (err?.status === 403) throw err;
    });
  }
}
