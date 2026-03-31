// src/hr/hr-dashboard.resolver.ts

import { Resolver, Query, Args, Context } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { HrDashboardService } from './hr-dashboard.service';
import { runWithTenantContext } from '@common/context/tenant-context';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class HrDashboardResolver {
  constructor(private readonly hrService: HrDashboardService) {}

  @Query(() => String, { name: 'headcount' })
  async headcount(
    @Args('department', { nullable: true }) department?: string,
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
      async () => JSON.stringify(await this.hrService.headcount({ department, from, to })),
    );
  }

  @Query(() => String, { name: 'headcountTrend' })
  async headcountTrend(
    @Args('months', { nullable: true }) months?: number,
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
      async () => JSON.stringify(await this.hrService.headcountTrend(months ?? 12)),
    );
  }

  @Query(() => String, { name: 'attrition' })
  async attrition(
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    const now = new Date().toISOString();
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.hrService.attrition(from ?? yearAgo, to ?? now)),
    );
  }

  @Query(() => String, { name: 'payrollSummary' })
  async payrollSummary(
    @Args('department', { nullable: true }) department?: string,
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
      async () => JSON.stringify(await this.hrService.payrollSummary({ department })),
    );
  }

  @Query(() => String, { name: 'employees' })
  async employees(
    @Args('department', { nullable: true }) department?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('limit', { nullable: true }) limit?: number,
    @Args('offset', { nullable: true }) offset?: number,
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
          await this.hrService.listEmployees(
            { department, status: status as any },
            limit ?? 50,
            offset ?? 0,
          ),
        ),
    );
  }

  private getUser(ctx: GraphQLContext | undefined) {
    const user = ctx?.req?.user;
    if (!user) throw new BadRequestException('Unauthorized');
    return user;
  }
}
