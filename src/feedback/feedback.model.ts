import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class FeedbackModel {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  userId: string;

  @Field(() => ID)
  insightId: string;

  @Field()
  rating: string;

  @Field({ nullable: true })
  comment?: string;

  @Field()
  createdAt: string;
}
