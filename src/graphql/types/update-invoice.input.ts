// @ts-ignore
import { InputType, Field, Float } from '@nestjs/graphql';
import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';
import { InvoiceStatus } from './invoice.type';

@InputType()
export class UpdateInvoiceInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  customerName?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  currency?: string;

  @Field(() => InvoiceStatus, { nullable: true })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  externalId?: string;
}
