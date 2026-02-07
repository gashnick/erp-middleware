// src/invoices/dto/create-invoice.dto.ts
import { IsString, IsNumber, IsOptional, IsEnum, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PAID = 'paid',
  VOID = 'void',
}

export class CreateInvoiceDto {
  @ApiProperty({ example: 'Acme Co', description: 'Customer name for the invoice' })
  @IsString()
  @IsNotEmpty()
  customer_name: string;

  @ApiPropertyOptional({ example: 'INV-2026-0001', description: 'Optional invoice number from the system' })
  @IsString()
  @IsOptional()
  invoice_number?: string;

  @ApiProperty({ example: 150.5, description: 'Total invoice amount (two decimal places)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({ example: InvoiceStatus.PENDING, description: 'Invoice lifecycle status', enum: InvoiceStatus })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  /**
   * 🛡️ PRIORITY 4: IDEMPOTENCY
   * Used to map records from external systems (CSV, QB, etc.)
   */
  @ApiPropertyOptional({ example: 'QB-INV-1001', description: 'External system id used for idempotency' })
  @IsString()
  @IsOptional()
  external_id?: string;

  @ApiPropertyOptional({ example: 'USD', description: 'Currency code for the invoice' })
  @IsString()
  @IsOptional()
  currency?: string = 'USD';

  @ApiPropertyOptional({ description: 'Arbitrary metadata for custom integrations', type: 'object', additionalProperties: true, example: { source: 'csv' } })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
