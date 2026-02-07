import { Module } from '@nestjs/common';
import { SubscriptionPlansService } from './subscriptionPlan.service';
import { SubscriptionPlansController } from './subscriptionPlan.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { DatabaseModule } from '@database/database.module';

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionPlan]), DatabaseModule],
  controllers: [SubscriptionPlansController],
  providers: [SubscriptionPlansService],
})
export class SubscriptionPlanModule {}
