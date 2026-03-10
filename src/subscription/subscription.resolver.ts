// src/subscriptions/subscription.resolver.ts

import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { SubscriptionService } from './subscription.service';
import { FeatureFlagService } from './feature-flag.service';
import { runWithTenantContext } from '@common/context/tenant-context';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class SubscriptionResolver {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => String, { name: 'currentPlan' })
  async currentPlan(@Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const sub = await this.subscriptionService.getCurrent(user.tenantId);
        return JSON.stringify(sub);
      },
    );
  }

  @Query(() => String, { name: 'subscriptionUsage' })
  async subscriptionUsage(@Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const usage = await this.subscriptionService.getUsageSummary(user.tenantId);
        return JSON.stringify(usage);
      },
    );
  }

  @Query(() => String, { name: 'seatInfo' })
  async seatInfo(@Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const [count, users] = await Promise.all([
          this.subscriptionService.getSeatCount(user.tenantId),
          this.subscriptionService.listSeats(user.tenantId),
        ]);
        return JSON.stringify({ ...count, users });
      },
    );
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  @Mutation(() => String, { name: 'upgradePlan' })
  async upgradePlan(@Args('slug') slug: string, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const result = await this.subscriptionService.upgrade(user.tenantId, slug);
        return JSON.stringify(result);
      },
    );
  }

  @Mutation(() => String, { name: 'downgradePlan' })
  async downgradePlan(@Args('slug') slug: string, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        const result = await this.subscriptionService.downgrade(user.tenantId, slug);
        return JSON.stringify(result);
      },
    );
  }

  @Mutation(() => Boolean, { name: 'deactivateSeat' })
  async deactivateSeat(@Args('userId') userId: string, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        await this.subscriptionService.deactivateSeat(user.tenantId, userId);
        return true;
      },
    );
  }
}
