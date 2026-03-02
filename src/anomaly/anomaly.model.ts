import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class AnomalyModel {
  @Field(() => ID) id: string;
  @Field() tenantId: string;
  @Field() type: string;
  @Field(() => Float) score: number;
  @Field(() => Float) confidence: number;
  @Field() explanation: string;
  @Field(() => [String]) relatedIds: string[];
  @Field() detectedAt: string;
}
