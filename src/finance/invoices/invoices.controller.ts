import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { getTenantContext } from '@common/context/tenant-context';

@Controller('invoices')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  async create(@Body() dto: CreateInvoiceDto) {
    // Pull from AsyncLocalStorage via your helper
    const { schemaName } = getTenantContext();

    return this.invoicesService.create(dto, schemaName);
  }
}
