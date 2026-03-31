// src/hr/hr.module.ts

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { SubscriptionModule } from '@subscription/subscription.module'; // For FeatureFlagService
import { HrDashboardService } from './hr-dashboard.service';
import { HrDashboardController } from './hr-dashboard.controller';
import { HrDashboardResolver } from './hr-dashboard.resolver';

@Module({
  imports: [
    DatabaseModule,
    SubscriptionModule, // FeatureFlagService for hr_dashboard feature gate
  ],
  providers: [HrDashboardService, HrDashboardResolver],
  controllers: [HrDashboardController],
  exports: [HrDashboardService],
})
export class HrModule {}
