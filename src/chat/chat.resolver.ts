import { Resolver, Query, Mutation, Args, ID, Subscription, Context } from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { ChatService } from './chat.service';
import { ChatSessionModel, ChatMessageModel } from './chat.models';
import { PubSub } from 'graphql-subscriptions';
import { PUB_SUB } from '@common/pubsub/pubsub.token';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { runWithTenantContext } from '@common/context/tenant-context';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class ChatResolver {
  constructor(
    private readonly chatService: ChatService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => ChatSessionModel, { nullable: true })
  chatSession(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
        schemaName: user.schemaName,
      },
      () => this.chatService.getSession(id),
    );
  }

  @Mutation(() => ChatSessionModel)
  createChatSession(@Context() ctx: GraphQLContext) {
    const user = ctx.req.user;
    //console.log('🔍 CREATE SESSION USER:', JSON.stringify(ctx.req.user));
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
        schemaName: user.schemaName,
      },
      () => this.chatService.createSession(user.id),
    );
  }

  @Mutation(() => ChatMessageModel)
  sendMessage(
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('text') text: string,
    @Context() ctx: GraphQLContext,
  ) {
    const user = ctx.req.user;
    //console.log('🔍 SCHEMA IN RESOLVER:', user.schemaName, '| TENANT:', user.tenantId);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
        schemaName: user.schemaName,
      },
      () => this.chatService.handleMessage(user.id, sessionId, text, ctx.req),
    );
  }

  @Subscription(() => ChatMessageModel, {
    filter: (payload, variables) => payload.messageStream.sessionId === variables.sessionId,
  })
  messageStream(@Args('sessionId', { type: () => ID }) _sessionId: string) {
    return this.pubSub.asyncIterableIterator('MESSAGE_STREAM');
  }
}
