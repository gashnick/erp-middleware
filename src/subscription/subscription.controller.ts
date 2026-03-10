// src/subscriptions/subscription.controller.ts

import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { SubscriptionService } from './subscription.service';

const VALID_PLANS = ['free', 'basic', 'standard', 'enterprise'];

@ApiTags('Subscription')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  // GET /api/subscription
  // Current plan details + seat count
  @Get()
  async getCurrent() {
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    return this.subscriptionService.getCurrent(tenantId);
  }

  // GET /api/subscription/usage
  // Full usage breakdown per feature for current period
  @Get('usage')
  async getUsage() {
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    return this.subscriptionService.getUsageSummary(tenantId);
  }

  // GET /api/subscription/seats
  // Seat count + user list with seat status
  @Get('seats')
  async getSeats() {
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    const [count, users] = await Promise.all([
      this.subscriptionService.getSeatCount(tenantId),
      this.subscriptionService.listSeats(tenantId),
    ]);
    return { ...count, users };
  }

  // PUT /api/subscription/upgrade
  // Body: { "planSlug": "standard" }
  @Put('upgrade')
  @HttpCode(HttpStatus.OK)
  async upgrade(@Body('planSlug') planSlug: string) {
    this.assertValidPlan(planSlug);
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    return this.subscriptionService.upgrade(tenantId, planSlug);
  }

  // PUT /api/subscription/downgrade
  // Body: { "planSlug": "basic" }
  @Put('downgrade')
  @HttpCode(HttpStatus.OK)
  async downgrade(@Body('planSlug') planSlug: string) {
    this.assertValidPlan(planSlug);
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    return this.subscriptionService.downgrade(tenantId, planSlug);
  }

  // POST /api/subscription/seats/:userId/deactivate
  @Post('seats/:userId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivateSeat(@Param('userId') userId: string) {
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    await this.subscriptionService.deactivateSeat(tenantId, userId);
    return { message: 'Seat deactivated successfully' };
  }

  // POST /api/subscription/seats/:userId/activate
  @Post('seats/:userId/activate')
  @HttpCode(HttpStatus.OK)
  async activateSeat(@Param('userId') userId: string) {
    const { tenantId } = this.tenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context required');
    await this.subscriptionService.activateSeat(tenantId, userId);
    return { message: 'Seat activated successfully' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private tenantContext() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    return ctx;
  }

  private assertValidPlan(planSlug: string): void {
    if (!planSlug || !VALID_PLANS.includes(planSlug)) {
      throw new BadRequestException(
        `Invalid plan '${planSlug}'. Must be one of: ${VALID_PLANS.join(', ')}`,
      );
    }
  }
}
