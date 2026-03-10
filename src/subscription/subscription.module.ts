import { SubscriptionPlan } from './../subscription-plans/entities/subscription-plan.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
// src/subscriptions/subscription.module.ts

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { FeatureFlagService } from './feature-flag.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionResolver } from './subscription.resolver';
import { SubscriptionPlansService } from '@subscription-plans/subscriptionPlan.service';
import { SubscriptionPlansController } from '@subscription-plans/subscriptionPlan.controller';
import { Subscription } from './entities/subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, SubscriptionPlan]), DatabaseModule],
  controllers: [SubscriptionController, SubscriptionPlansController],
  providers: [
    FeatureFlagService,
    SubscriptionService,
    SubscriptionResolver,
    SubscriptionPlansService,
  ],
  exports: [FeatureFlagService, SubscriptionService],
})
export class SubscriptionModule {}
