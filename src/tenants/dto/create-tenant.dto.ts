import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({
    description: 'The legal name of the organization',
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
    description: 'Data isolation strategy',
    example: 'external',
    enum: ['internal', 'external'],
    default: 'external',
  })
  @IsEnum(['internal', 'external'])
  @IsNotEmpty()
  // Note: 'external' usually means isolated schema in your current setup
  dataSourceType: 'internal' | 'external';

  @ApiProperty({
    description: 'Subscription plan slug (must exist in subscription_plans table)',
    example: 'free',
    enum: ['free', 'basic', 'standard', 'enterprise'], // Added 'free'
    default: 'free',
  })
  @IsEnum(['free', 'basic', 'standard', 'enterprise'])
  @IsNotEmpty()
  subscriptionPlan: string;
}
