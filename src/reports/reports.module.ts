// src/reports/reports.module.ts

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@database/database.module';
import { SubscriptionModule } from '@subscription/subscription.module';
import { HrModule } from '@hr/hr.module';
import { OpsModule } from '@ops/ops.module';
import { CronHelperService } from './cron-helper.service';
import { EmailService } from './email.service';
import { ReportGeneratorService } from './report-generator.service';
import { ExportService } from './export.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportsController } from './reports.controller';
import { ReportsResolver } from './reports.resolver';

@Module({
  imports: [
    DatabaseModule, // TenantQueryRunnerService
    SubscriptionModule, // FeatureFlagService for 'reports' gate
    ScheduleModule, // @Cron decorator — already forRoot() in AppModule
    HrModule, // HrDashboardService for report data
    OpsModule, // OpsDashboardService for report data
  ],
  providers: [
    CronHelperService,
    EmailService,
    ReportGeneratorService,
    ExportService,
    ReportSchedulerService,
    ReportsResolver,
  ],
  controllers: [ReportsController],
  exports: [ReportGeneratorService, ExportService], // WhatsApp module (Stream 6) will use these
})
export class ReportsModule {}
