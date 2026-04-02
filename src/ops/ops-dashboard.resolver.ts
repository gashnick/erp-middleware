// src/ops/ops-dashboard.resolver.ts
//
// GraphQL resolver for the Operations Dashboard.
// Mirrors the REST surface — clients can use either API.
//
// Pattern matches HrDashboardResolver exactly:
//   1. getUser(ctx)              — null-guard the GraphQL context
//   2. runWithTenantContext(...) — restore AsyncLocalStorage for DB calls
//   3. JSON.stringify(result)    — consistent with all existing resolvers
//
// Queries:
//   inventorySummary   — InventorySummary as JSON string
//   assetStatus        — Asset[] as JSON string
//   ordersPipeline     — OrdersPipeline as JSON string
//   slaStatus          — SlaStatusResult as JSON string
//   slaBreaches        — SlaStatusItem[] as JSON string

import { Resolver, Query, Args, Context, Float } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { runWithTenantContext } from '@common/context/tenant-context';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { OpsDashboardService } from './ops-dashboard.service';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class OpsDashboardResolver {
  constructor(private readonly opsService: OpsDashboardService) {}

  @Query(() => String, { name: 'inventorySummary' })
  async inventorySummary(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.opsService.inventorySummary()),
    );
  }

  @Query(() => String, { name: 'assetStatus' })
  async assetStatus(
    @Args('category', { nullable: true }) category?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('limit', { nullable: true, type: () => Float }) limit?: number,
    @Args('offset', { nullable: true, type: () => Float }) offset?: number,
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
          await this.opsService.assetStatus({
            category,
            status: status as any,
            limit: limit ?? 50,
            offset: offset ?? 0,
          }),
        ),
    );
  }

  @Query(() => String, { name: 'ordersPipeline' })
  async ordersPipeline(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.opsService.ordersPipeline()),
    );
  }

  @Query(() => String, { name: 'slaStatus' })
  async slaStatus(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.opsService.slaStatus()),
    );
  }

  @Query(() => String, { name: 'slaBreaches' })
  async slaBreaches(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.opsService.slaBreaches()),
    );
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private getUser(ctx: GraphQLContext | undefined) {
    const user = ctx?.req?.user;
    if (!user) throw new BadRequestException('Unauthorized');
    return user;
  }
}
