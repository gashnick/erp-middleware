import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { EtlModule } from '../etl/etl.module';
import { ConnectorHealthService } from './connector-health.service';
import { PostgresProvider } from './providers/postgres-provider';
import { QuickbooksProvider } from './providers/quickbooks-provider';
import { DatabaseModule } from '@database/database.module';

@Module({
  imports: [EtlModule, DatabaseModule], // Make sure EtlModule is here to provide EtlService
  controllers: [ConnectorsController],
  providers: [ConnectorHealthService, PostgresProvider, QuickbooksProvider],
  exports: [ConnectorHealthService],
})
export class ConnectorsModule {}
