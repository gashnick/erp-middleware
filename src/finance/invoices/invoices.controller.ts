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
    // Pull from AsyncLocalStorage via your helper
    const { schemaName } = getTenantContext();

    return this.invoicesService.create(dto, schemaName);
  }

  @Get()
  async findAll(@Req() req: AuthenticatedRequest) {
    // Because of our middleware/guard, the search_path is already set
    // to the tenant's private schema. This query is safe and isolated.
    return this.tenantDb.execute('SELECT * FROM invoices ORDER BY created_at DESC');
  }
}
