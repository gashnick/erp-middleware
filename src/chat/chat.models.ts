import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class ChatMessageModel {
  @Field(() => ID) id: string;
  @Field(() => ID) sessionId: string;
  @Field() role: string;
  @Field(() => GraphQLJSON) content: object;
  @Field(() => Int, { nullable: true }) latencyMs?: number;
  @Field() createdAt: string;
}

@ObjectType()
export class ChatSessionModel {
  @Field(() => ID) id: string;
  @Field(() => [ChatMessageModel]) messages: ChatMessageModel[];
  @Field() createdAt: string;
}
