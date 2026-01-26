import { Controller, Post, Body, Req, UseGuards, Get } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    tenantId: string;
    role: string;
  };
}
@Controller('invoices')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  @Post()
  async create(@Body() dto: CreateInvoiceDto) {
    const { schemaName } = getTenantContext();
    return this.invoicesService.create(dto, schemaName);
  }

  @Get()
  async findAll(@Req() req: AuthenticatedRequest) {
    // Pass the tenantId from the JWT token to the service for decryption
    return this.invoicesService.findAll(req.user.tenantId);
  }
}
