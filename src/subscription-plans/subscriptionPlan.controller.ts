import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { SubscriptionPlansService } from './subscriptionPlan.service';

@Controller('subscription-plans')
export class SubscriptionPlansController {
  constructor(private readonly service: SubscriptionPlansService) {}

  @Get()
  async getPlans() {
    return this.service.findAllPublic();
  }

  @Get(':slug')
  async getPlan(@Param('slug') slug: string) {
    const plan = await this.service.findBySlug(slug);

    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }

    return plan;
  }
}
