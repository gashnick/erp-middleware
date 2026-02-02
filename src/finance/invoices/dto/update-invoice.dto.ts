// src/invoices/dto/update-invoice.dto.ts
import { IsEnum, IsNumber, IsOptional, IsObject } from 'class-validator';
import { InvoiceStatus } from './create-invoice.dto';

export class UpdateInvoiceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  amount?: number;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
