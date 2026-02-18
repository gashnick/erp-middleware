// @ts-ignore
import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

registerEnumType(InvoiceStatus, { name: 'InvoiceStatus' });

@ObjectType()
export class Invoice {
  @Field(() => ID)
  id: string;

  @Field()
  customerName: string;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;

  @Field(() => InvoiceStatus)
  status: InvoiceStatus;

  @Field({ nullable: true })
  externalId?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
