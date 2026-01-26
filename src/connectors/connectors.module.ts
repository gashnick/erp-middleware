import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { EtlModule } from '../etl/etl.module';

@Module({
  imports: [EtlModule], // Make sure EtlModule is here to provide EtlService
  controllers: [ConnectorsController],
  providers: [],
})
export class ConnectorsModule {}
