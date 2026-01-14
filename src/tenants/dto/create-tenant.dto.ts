import { IsString, IsEnum, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Create Tenant DTO
 *
 * Data Transfer Object for creating a new tenant.
 * Includes validation rules using class-validator.
 *
 * Code Complete Principle: Validate at the boundary (API layer)
 */

export class CreateTenantDto {
  @ApiProperty({
    description: 'Company or organization name',
    example: 'Acme Corporation',
    minLength: 2,
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(255)
  companyName: string;

  @ApiProperty({
    description: 'Data source type: internal (has own DB) or external (we are DB)',
    example: 'external',
    enum: ['internal', 'external'],
  })
  @IsEnum(['internal', 'external'])
  @IsNotEmpty()
  dataSourceType: 'internal' | 'external';

  @ApiProperty({
    description: 'Subscription plan',
    example: 'basic',
    enum: ['basic', 'standard', 'enterprise'],
    default: 'basic',
  })
  @IsEnum(['basic', 'standard', 'enterprise'])
  @IsNotEmpty()
  subscriptionPlan: 'basic' | 'standard' | 'enterprise';
}

/**
 * Update Tenant DTO
 *
 * For updating tenant information.
 * All fields optional (partial update).
 */

export class UpdateTenantDto {
  @ApiProperty({
    description: 'Company name',
    example: 'Acme Corp',
    required: false,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  companyName?: string;

  @ApiProperty({
    description: 'Subscription plan',
    example: 'standard',
    enum: ['basic', 'standard', 'enterprise'],
    required: false,
  })
  @IsEnum(['basic', 'standard', 'enterprise'])
  subscriptionPlan?: 'basic' | 'standard' | 'enterprise';

  @ApiProperty({
    description: 'Tenant status',
    example: 'active',
    enum: ['active', 'suspended', 'cancelled'],
    required: false,
  })
  @IsEnum(['active', 'suspended', 'cancelled'])
  status?: 'active' | 'suspended' | 'cancelled';
}
