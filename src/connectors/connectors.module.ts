import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { EtlModule } from '../etl/etl.module';
import { ConnectorHealthService } from './connector-health.service';
import { DatabaseModule } from '@database/database.module';
import { ConnectorFactory } from './services/connector-factory.service';

@Module({
  imports: [EtlModule, DatabaseModule],
  controllers: [ConnectorsController],
  providers: [ConnectorHealthService, ConnectorFactory],
  exports: [ConnectorHealthService, ConnectorFactory],
})
export class ConnectorsModule {}
