import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { AnomalyService } from './anomaly.service';
import { AnomalyType } from './anomaly.types';

@Controller('insights')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AnomalyController {
  constructor(private readonly anomalyService: AnomalyService) {}

  @Get()
  listInsights(@Query('types') types?: string, @Query('minScore') minScore?: string) {
    return this.anomalyService.listAnomalies(
      types ? (types.split(',') as AnomalyType[]) : undefined,
      minScore ? parseFloat(minScore) : undefined,
    );
  }

  @Get(':id')
  getInsight(@Param('id') id: string) {
    return this.anomalyService.getAnomaly(id);
  }

  /** REST command: trigger scan after connector sync. */
  @Post('scan')
  async triggerScan() {
    // This now returns a job ID or status
    return this.anomalyService.enqueueScan();
  }
}
