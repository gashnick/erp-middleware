import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { DatabaseModule } from '../database/database.module';
import { EtlModule } from '../etl/etl.module';
import { EncryptionModule } from '@common/security/encryption.module';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([]), EtlModule, EncryptionModule], // Add entities if needed
  controllers: [InvoicesController, FinanceController],
  providers: [InvoicesService, FinanceAnalyticsService, FinanceService],
  exports: [InvoicesService, FinanceAnalyticsService, FinanceService],
})
export class FinanceModule {}
