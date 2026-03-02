import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from '@database/database.module';
import { AnalyticsModule } from '@analytics/analytics.module';
import { AnomalyService } from './anomaly.service';
import { AnomalyRepository } from './anomaly.repository';
import { AnomalyDetector } from './anomaly.detector';
import { AnomalyResolver } from './anomaly.resolver';
import { AnomalyController } from './anomaly.controller';
import { AuditModule } from '@common/audit/audit.module';
// AuditLogService is already registered in DatabaseModule or a shared module in your project
// Import whichever module exports it — adjust the import to match your existing structure

@Module({
  imports: [
    DatabaseModule,
    AnalyticsModule,
    BullModule.registerQueue({ name: 'anomaly-scan' }),
    AuditModule,
  ],
  providers: [AnomalyService, AnomalyRepository, AnomalyDetector, AnomalyResolver],
  controllers: [AnomalyController],
  exports: [AnomalyService],
})
export class AnomalyModule {}
