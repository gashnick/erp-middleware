import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class MonthlyRevenueModel {
  @Field(() => Int) month: number;
  @Field(() => Int) year: number;
  @Field(() => Float) revenue: number;
  @Field() currency: string;
}

@ObjectType()
export class ExpenseCategoryModel {
  @Field() category: string;
  @Field() vendorId: string;
  @Field() vendorName: string;
  @Field(() => Float) total: number;
  @Field() currency: string;
}

@ObjectType()
export class CashPositionModel {
  @Field(() => Float) balance: number;
  @Field() currency: string;
  @Field() asOf: string;
}
