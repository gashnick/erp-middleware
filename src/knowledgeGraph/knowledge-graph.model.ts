import { ObjectType, Field, ID } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-type-json';

@ObjectType()
export class KGEntityModel {
  @Field(() => ID)
  id: string;

  @Field()
  type: string;

  @Field()
  external_id: string;

  @Field()
  label: string;

  @Field(() => GraphQLJSONObject)
  meta: Record<string, any>;
}
