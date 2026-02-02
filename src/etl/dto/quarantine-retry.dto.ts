import { ApiProperty } from '@nestjs/swagger';

export class RetryRecordDto {
  @ApiProperty({
    description: 'The fixed data object that will replace the raw_data in quarantine',
    example: {
      external_id: 'INV-1001',
      amount: 150.5,
      customer_name: 'John Doe',
    },
  })
  fixedData: any;
}

export class BatchRetryDto {
  @ApiProperty({
    description: 'Array of Quarantine Record UUIDs to retry',
    example: ['550e8400-e29b-41d4-a716-446655440000', '671e8400-e29b-41d4-a716-446655440001'],
    type: [String],
  })
  ids: string[];
}
