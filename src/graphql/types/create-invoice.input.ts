// @ts-ignore
import { InputType, Field, Float } from '@nestjs/graphql';
import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';
import { InvoiceStatus } from './invoice.type';

@InputType()
export class CreateInvoiceInput {
  @Field()
  @IsString()
  customerName: string;

  @Field(() => Float)
  @IsNumber()
  amount: number;

  @Field({ defaultValue: 'USD' })
  @IsString()
  currency: string;

  @Field(() => InvoiceStatus, { defaultValue: InvoiceStatus.DRAFT })
  @IsEnum(InvoiceStatus)
  status: InvoiceStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  externalId?: string;
}
