// src/invoices/dto/update-invoice.dto.ts
import { IsEnum, IsNumber, IsOptional, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from './create-invoice.dto';

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ example: 150.5, description: 'The updated invoice amount' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ example: InvoiceStatus.PENDING, description: 'Updated invoice status', enum: InvoiceStatus })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Arbitrary metadata to attach to the invoice', type: 'object', additionalProperties: true, example: { department: 'sales' } })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
