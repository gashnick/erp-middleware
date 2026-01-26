import { DatabaseModule } from '@database/database.module';
import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { EtlModule } from '../../etl/etl.module';
import { EncryptionModule } from '@common/security/encryption.module';
@Module({
  imports: [DatabaseModule, EtlModule, EncryptionModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
