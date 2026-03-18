// src/alerts/alert.resolver.ts

import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { AlertRuleService } from './alert-rule.service';
import { AlertEventService } from './alert-event.service';
import { runWithTenantContext } from '@common/context/tenant-context';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class AlertResolver {
  constructor(
    private readonly ruleService: AlertRuleService,
    private readonly eventService: AlertEventService,
  ) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => String, { name: 'alertRules' })
  async alertRules(
    @Args('isActive', { nullable: true }) isActive?: boolean,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.ruleService.list({ isActive })),
    );
  }

  @Query(() => String, { name: 'alertEvents' })
  async alertEvents(
    @Args('status', { nullable: true }) status?: string,
    @Args('severity', { nullable: true }) severity?: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () =>
        JSON.stringify(
          await this.eventService.list({
            status: status as any,
            severity: severity as any,
            from,
            to,
          }),
        ),
    );
  }

  @Query(() => String, { name: 'openAlerts' })
  async openAlerts(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.eventService.openAlerts()),
    );
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  @Mutation(() => String, { name: 'createAlertRule' })
  async createAlertRule(
    @Args('name') name: string,
    @Args('metric') metric: string,
    @Args('operator') operator: string,
    @Args('threshold') threshold: number,
    @Args('severity') severity: string,
    @Args('channels', { type: () => [String] }) channels: string[],
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () =>
        JSON.stringify(
          await this.ruleService.create(
            {
              name,
              metric: metric as any,
              operator: operator as any,
              threshold,
              severity: severity as any,
              channels: channels as any,
            },
            user.id,
            user.tenantId,
          ),
        ),
    );
  }

  @Mutation(() => String, { name: 'updateAlertRule' })
  async updateAlertRule(
    @Args('id') id: string,
    @Args('name', { nullable: true }) name?: string,
    @Args('operator', { nullable: true }) operator?: string,
    @Args('threshold', { nullable: true }) threshold?: number,
    @Args('severity', { nullable: true }) severity?: string,
    @Args('channels', { nullable: true, type: () => [String] }) channels?: string[],
    @Args('isActive', { nullable: true }) isActive?: boolean,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () =>
        JSON.stringify(
          await this.ruleService.update(id, {
            name,
            operator: operator as any,
            threshold,
            severity: severity as any,
            channels: channels as any,
            isActive,
          }),
        ),
    );
  }

  @Mutation(() => Boolean, { name: 'deleteAlertRule' })
  async deleteAlertRule(@Args('id') id: string, @Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => {
        await this.ruleService.delete(id);
        return true;
      },
    );
  }

  @Mutation(() => String, { name: 'acknowledgeAlert' })
  async acknowledgeAlert(@Args('id') id: string, @Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.eventService.acknowledge(id, user.id)),
    );
  }

  @Mutation(() => String, { name: 'resolveAlert' })
  async resolveAlert(@Args('id') id: string, @Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.eventService.resolve(id)),
    );
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private getUser(ctx: GraphQLContext | undefined) {
    const user = ctx?.req?.user;
    if (!user) throw new BadRequestException('Unauthorized');
    return user;
  }
}
