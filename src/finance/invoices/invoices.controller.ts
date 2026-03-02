import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { TenantGuard } from '@common/guards/tenant.guard';
import { TenantRateLimitGuard } from '@common/guards/tenant-rate-limit.guard';
import { ActiveTenant } from '@common/decorators/active-tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { getTenantContext } from '@common/context/tenant-context';

@Controller('invoices')
@UseGuards(JwtAuthGuard, TenantGuard, TenantRateLimitGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  async create(@ActiveTenant('id') tenantId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(tenantId, dto);
  }

  @Get()
  async findAll(@ActiveTenant('id') tenantId: string) {
    const invoices = await this.invoicesService.findAll(tenantId);
    return { data: invoices };
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

  @Post('export')
  async export() {
    const ctx = getTenantContext();
    if (ctx?.userRole !== 'ADMIN') {
      throw new ForbiddenException('Insufficient privileges to export invoices');
    }
    return { exported: true };
  }
}
