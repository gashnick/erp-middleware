import { ApiProperty } from '@nestjs/swagger';

export class SyncStatusDto {
  @ApiProperty({ example: 1250 })
  totalInvoices: number;

  @ApiProperty({ example: 42 })
  quarantineCount: number;

  @ApiProperty({ example: '96.7%' })
  healthPercentage: string;

  @ApiProperty({
    example: {
      lastSync: '2026-02-01T10:00:00Z',
      source: 'quickbooks',
      status: 'success',
    },
  })
  latestActivity: any;
}
