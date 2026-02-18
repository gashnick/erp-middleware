import { Controller, Get, Req, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { TenantRateLimitGuard } from '@common/guards/tenant-rate-limit.guard';
import { FinanceService } from '@finance/finance.service';
import { AnalyticsService } from '@ai/services/analytics.service';
import { AnomalyDetectionService } from '@ai/services/anomaly-detection.service';

@ApiTags('Insights')
@Controller('insights')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRateLimitGuard)
@ApiBearerAuth()
export class InsightsController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly analyticsService: AnalyticsService,
    private readonly anomalyDetection: AnomalyDetectionService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get consolidated finance dashboard' })
  async getDashboard(@Req() req: Request) {
    const tenantId = (req.user as any).tenantId;
    return await this.financeService.getDashboardStats(tenantId);
  }

  @Get('analytics/insights')
  @ApiOperation({ summary: 'Generate AI insights for tenant' })
  async generateInsights(@Req() req: Request) {
    const tenantId = (req.user as any).tenantId;
    return await this.analyticsService.generateInsights(tenantId);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Detect anomalies for tenant' })
  async detectAnomalies(@Req() req: Request, @Query('since') since?: string) {
    const tenantId = (req.user as any).tenantId;
    // Currently anomaly detection service accepts tenantId; optional since param may be added in service layer
    return await this.anomalyDetection.detectAnomalies(tenantId);
  }
}
