import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { DatabaseModule } from '../database/database.module';
import { EtlModule } from '../etl/etl.module';
import { EncryptionModule } from '@common/security/encryption.module';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([]), EtlModule, EncryptionModule], // Add entities if needed
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class FinanceModule {}
