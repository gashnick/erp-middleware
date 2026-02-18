import { Controller, Get, Param, UseGuards, Req, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProductionRateLimitGuard } from '../common/guards/production-rate-limit.guard';
import { AnalyticsService } from './services/analytics.service';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { AIInsightsService } from './services/ai-insights.service';
import { AnalyticsQueryDto } from './dto/analytics.dto';

@ApiTags('Analytics & Insights')
@Controller('ai')
@UseGuards(JwtAuthGuard, ProductionRateLimitGuard)
@ApiBearerAuth()
export class AIController {
  constructor(
    private analyticsService: AnalyticsService,
    private anomalyDetection: AnomalyDetectionService,
    private aiInsightsService: AIInsightsService,
  ) {}

  @Get('analytics/revenue')
  @ApiOperation({ summary: 'Get revenue analytics by period' })
  async getRevenueAnalytics(@Req() req: Request, @Query() query: AnalyticsQueryDto) {
    const tenantId = (req.user as any).tenantId;
    const startDate = query.startDate ? new Date(query.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    
    return await this.analyticsService.getRevenueByMonth(tenantId, startDate, endDate);
  }

  @Get('analytics/expenses')
  @ApiOperation({ summary: 'Get expense breakdown' })
  async getExpenseBreakdown(@Req() req: Request, @Query() query: AnalyticsQueryDto) {
    const tenantId = (req.user as any).tenantId;
    const startDate = query.startDate ? new Date(query.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    
    return await this.analyticsService.getExpenseBreakdown(tenantId, startDate, endDate);
  }

  @Get('analytics/cash-position')
  @ApiOperation({ summary: 'Get current cash position' })
  async getCashPosition(@Req() req: Request) {
    const tenantId = (req.user as any).tenantId;
    return await this.analyticsService.getCashPosition(tenantId);
  }

  @Get('analytics/insights')
  @ApiOperation({ summary: 'Get AI-generated insights' })
  async getInsights(@Req() req: Request) {
    const tenantId = (req.user as any).tenantId;
    return await this.analyticsService.generateInsights(tenantId);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Detect financial anomalies' })
  async detectAnomalies(@Req() req: Request) {
    const tenantId = (req.user as any).tenantId;
    return await this.anomalyDetection.detectAnomalies(tenantId);
  }

  @Get('anomalies/:id/explain')
  @ApiOperation({ summary: 'Get detailed explanation for an anomaly' })
  async explainAnomaly(@Req() req: Request, @Param('id') anomalyId: string) {
    const tenantId = (req.user as any).tenantId;
    return await this.anomalyDetection.explainAnomaly(tenantId, anomalyId);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Get recent AI insights' })
  async getRecentInsights(@Req() req: Request, @Query('limit') limit?: number) {
    const tenantId = (req.user as any).tenantId;
    return await this.aiInsightsService.getRecentInsights(tenantId, limit ? parseInt(limit as any) : 20);
  }

  @Get('insights/:entityType/:entityId')
  @ApiOperation({ summary: 'Get AI insights for specific entity' })
  async getInsightsForEntity(
    @Req() req: Request,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const tenantId = (req.user as any).tenantId;
    return await this.aiInsightsService.getInsightsForEntity(tenantId, entityType, entityId);
  }
}
