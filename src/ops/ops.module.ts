// src/ops/ops.module.ts

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { SubscriptionModule } from '@subscription/subscription.module';
import { OpsDashboardService } from './ops-dashboard.service';
import { OpsDashboardController } from './ops-dashboard.controller';
import { OpsDashboardResolver } from './ops-dashboard.resolver';

@Module({
  imports: [
    DatabaseModule, // TenantQueryRunnerService
    SubscriptionModule, // FeatureFlagService for 'ops_dashboard' gate
  ],
  providers: [OpsDashboardService, OpsDashboardResolver],
  controllers: [OpsDashboardController],
  exports: [OpsDashboardService], // ReportsModule (Stream 5) will import this
})
export class OpsModule {}
