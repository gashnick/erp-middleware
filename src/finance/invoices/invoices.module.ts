import { DatabaseModule } from '@database/database.module';
import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { EtlModule } from '../../etl/etl.module';
import { EncryptionModule } from '@common/security/encryption.module';
import { TenantsModule } from '@tenants/tenants.module';
@Module({
  imports: [DatabaseModule, EtlModule, EncryptionModule, TenantsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
