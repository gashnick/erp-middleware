import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIController } from './ai.controller';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { AnalyticsService } from './services/analytics.service';
import { AIInsightsService } from './services/ai-insights.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AIController],
  providers: [
    AnomalyDetectionService,
    AnalyticsService,
    AIInsightsService,
  ],
  exports: [
    AnomalyDetectionService,
    AnalyticsService,
    AIInsightsService,
  ],
})
export class AIModule {}
