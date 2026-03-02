import { Resolver, Query, Args, Subscription, ID, Context } from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { AnomalyService } from './anomaly.service';
import { AnomalyModel } from './anomaly.model';
import { PubSub } from 'graphql-subscriptions';
import { PUB_SUB } from '@common/pubsub/pubsub.token';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { runWithTenantContext } from '@common/context/tenant-context';

@Resolver(() => AnomalyModel)
@UseGuards(JwtAuthGuard, TenantGuard)
export class AnomalyResolver {
  constructor(
    private readonly anomalyService: AnomalyService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => [AnomalyModel])
  anomalies(
    @Args('types', { type: () => [String], nullable: true }) types: string[] | undefined,
    @Args('minScore', { type: () => Number, nullable: true }) minScore: number | undefined,
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
      () => this.anomalyService.listAnomalies(types as any, minScore),
    );
  }

  @Query(() => AnomalyModel, { nullable: true })
  anomaly(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      () => this.anomalyService.getAnomaly(id),
    );
  }

  /**
   * Real-time subscription for anomalies.
   * The filter ensures a tenant only receives events belonging to them.
   * Subscriptions run in a WebSocket context — no runWithTenantContext needed
   * here since the filter only reads from the payload and context, it does
   * not call any service that uses getTenantContext().
   */
  @Subscription(() => AnomalyModel, {
    filter: (payload, _vars, context: GraphQLContext) => {
      const currentTenantId = context.req.user?.tenantId;
      return payload.anomalyRaised.tenantId === currentTenantId;
    },
  })
  anomalyRaised() {
    return this.pubSub.asyncIterableIterator('ANOMALY_RAISED');
  }
}
