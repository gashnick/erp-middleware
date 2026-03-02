import { Resolver, Query, Args, Int, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { AnalyticsService } from './analytics.service';
import { MonthlyRevenueModel, ExpenseCategoryModel, CashPositionModel } from './analytics.models';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { runWithTenantContext } from '@common/context/tenant-context';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class AnalyticsResolver {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Query(() => [MonthlyRevenueModel])
  revenueByMonth(@Args('year', { type: () => Int }) year: number, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      () => this.analyticsService.getRevenueByMonth(year),
    );
  }

  @Query(() => [ExpenseCategoryModel])
  expenseBreakdown(
    @Args('from') from: string,
    @Args('to') to: string,
    @Context() ctx: GraphQLContext,
  ) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      () => this.analyticsService.getExpenseBreakdown(new Date(from), new Date(to)),
    );
  }

  @Query(() => CashPositionModel, { nullable: true })
  cashPosition(
    @Args('asOf', { type: () => String, nullable: true }) asOf: string | undefined,
    @Context() ctx: GraphQLContext,
  ) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      () => this.analyticsService.getCashPosition(asOf ? new Date(asOf) : undefined),
    );
  }
}
