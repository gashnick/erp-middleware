// src/anomaly/anomaly.module.ts

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from '@database/database.module';
import { AnalyticsModule } from '@analytics/analytics.module';
import { AuditModule } from '@common/audit/audit.module';
import { AnomalyService } from './anomaly.service';
import { AnomalyRepository } from './anomaly.repository';
import { AnomalyDetector } from './anomaly.detector';
import { AnomalyProcessor } from './anomaly.processor';
import { AnomalyResolver } from './anomaly.resolver';
import { AnomalyController } from './anomaly.controller';

@Module({
  imports: [
    DatabaseModule, // TenantQueryRunnerService + DataSource
    AnalyticsModule, // AnalyticsRepository
    AuditModule, // AuditLogService
    BullModule.registerQueue({ name: 'anomaly-scan' }),
  ],
  providers: [
    AnomalyService,
    AnomalyRepository,
    AnomalyDetector,
    AnomalyProcessor, // ← was missing — Bull never consumed jobs without this
    AnomalyResolver,
  ],
  controllers: [AnomalyController],
  exports: [AnomalyService],
})
export class AnomalyModule {}
