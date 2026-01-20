import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([])], // Add entities if needed
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class FinanceModule {}
