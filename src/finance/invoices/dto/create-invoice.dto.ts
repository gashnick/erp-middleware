// src/invoices/dto/create-invoice.dto.ts
import { IsString, IsNumber, IsOptional, IsEnum, IsNotEmpty, IsObject } from 'class-validator';

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PAID = 'paid',
  VOID = 'void',
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  customer_name: string;

  @IsString()
  @IsOptional()
  invoice_number?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsNotEmpty()
  amount: number;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  /**
   * 🛡️ PRIORITY 4: IDEMPOTENCY
   * Used to map records from external systems (CSV, QB, etc.)
   */
  @IsString()
  @IsOptional()
  external_id?: string;

  @IsString()
  @IsOptional()
  currency?: string = 'USD';

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
