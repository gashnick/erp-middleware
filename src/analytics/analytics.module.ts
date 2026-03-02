import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { AnalyticsResolver } from './analytics.resolver';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsCacheService } from './analytics-cache.service';

@Module({
  imports: [DatabaseModule],
  providers: [AnalyticsResolver, AnalyticsService, AnalyticsRepository, AnalyticsCacheService],
  exports: [AnalyticsService, AnalyticsCacheService, AnalyticsRepository],
})
export class AnalyticsModule {}
