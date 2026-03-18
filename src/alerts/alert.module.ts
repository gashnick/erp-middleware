// src/alerts/alert.module.ts

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@database/database.module';
import { SubscriptionModule } from '@subscription/subscription.module';
import { AlertRuleService } from './alert-rule.service';
import { AlertEventService } from './alert-event.service';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertNotifierService } from './alert-notifier.service';
import { AlertSchedulerService } from './alert-scheduler.service';
import { AlertProcessor } from './alert.processor';
import { AlertController } from './alert.controller';
import { AlertResolver } from './alert.resolver';

@Module({
  imports: [
    DatabaseModule,
    SubscriptionModule, // FeatureFlagService for alert_rules limit
    ScheduleModule.forRoot(), // @Cron decorator support
    BullModule.registerQueue({ name: 'alert-evaluation' }),
  ],
  providers: [
    AlertRuleService,
    AlertEventService,
    AlertEvaluatorService,
    AlertNotifierService,
    AlertSchedulerService,
    AlertProcessor,
    AlertResolver,
  ],
  controllers: [AlertController],
  exports: [AlertRuleService, AlertEventService],
})
export class AlertModule {}
