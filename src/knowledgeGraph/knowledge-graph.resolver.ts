import { Resolver, Query, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { GraphQueryService } from './graph-query.service';
import { KGEntityModel } from './knowledge-graph.model';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { runWithTenantContext } from '@common/context/tenant-context';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class KnowledgeGraphResolver {
  constructor(private readonly graphQuery: GraphQueryService) {}

  @Query(() => [KGEntityModel])
  entitySearch(@Args('question') question: string, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      () => this.graphQuery.findRelevantEntities(question),
    );
  }
}
