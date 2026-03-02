import { Resolver, Mutation, Args, ID, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { FeedbackService } from './feedback.service';
import { FeedbackModel } from './feedback.model';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { runWithTenantContext } from '@common/context/tenant-context';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class FeedbackResolver {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Mutation(() => FeedbackModel)
  submitFeedback(
    @Args('insightId', { type: () => ID }) insightId: string,
    @Args('rating', { type: () => String }) rating: string,
    @Context() ctx: GraphQLContext,
    @Args('comment', { type: () => String, nullable: true }) comment?: string,
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
      () => this.feedbackService.submit(insightId, rating, comment, ctx.req),
    );
  }
}
