import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { TenantGuard } from '@common/guards/tenant.guard';
import { ActiveTenant } from '@common/decorators/active-tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@Controller('invoices')
@UseGuards(JwtAuthGuard, TenantGuard) // 🛡️ TenantGuard ensures tenantId exists before reaching here
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  async create(@ActiveTenant('id') tenantId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(tenantId, dto);
  }

  @Get()
  async findAll(@ActiveTenant('id') tenantId: string) {
    return this.invoicesService.findAll(tenantId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @ActiveTenant('id') tenantId: string) {
    return this.invoicesService.findOne(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @ActiveTenant('id') tenantId: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, tenantId, dto);
  }
}
