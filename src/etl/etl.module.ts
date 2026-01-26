import { Module } from '@nestjs/common';
import { EtlService } from './etl.service';
import { DatabaseModule } from '@database/database.module';
import { QuarantineController } from './quarantine.controller';
import { AuditModule } from '@common/audit/audit.module';
import { EncryptionModule } from '@common/security/encryption.module';
import { TenantsModule } from '@tenants/tenants.module';

@Module({
  imports: [DatabaseModule, AuditModule, EncryptionModule, TenantsModule],
  controllers: [QuarantineController],
  providers: [EtlService],
  exports: [EtlService],
})
export class EtlModule {}
