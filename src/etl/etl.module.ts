import { Module } from '@nestjs/common';
import { EtlService } from './services/etl.service';
import { DatabaseModule } from '@database/database.module';
import { QuarantineController } from './quarantine.controller';
import { AuditModule } from '@common/audit/audit.module';
import { EncryptionModule } from '@common/security/encryption.module';
import { TenantsModule } from '@tenants/tenants.module';
import { ConnectorHealthService } from '@connectors/connector-health.service';
import { PostgresProvider } from '@connectors/providers/postgres-provider';
import { QuickbooksProvider } from '@connectors/providers/quickbooks-provider';
import { QuarantineService } from './services/quarantine.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EtlTransformerService } from './services/etl-transformer.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    EncryptionModule,
    TenantsModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [QuarantineController, require('./etl.controller').EtlController],
  providers: [
    EtlService,
    ConnectorHealthService,
    PostgresProvider,
    QuickbooksProvider,
    QuarantineService,
    EtlTransformerService,
  ],
  exports: [EtlService],
})
export class EtlModule {}
