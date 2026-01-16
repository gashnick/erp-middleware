// src/finance/invoices/invoices.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { getTenantId, getUserId, getRequestId } from '../../common/context/tenant-context';

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  amount: number;
  status: string;
  created_at: Date;
}

@ApiTags('Invoices')
@Controller('invoices')
@UseGuards(TenantContextGuard) // Ensures tenant context is set
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all invoices for current tenant' })
  @ApiResponse({ status: 200, description: 'List of invoices' })
  async findAll(): Promise<Invoice[]> {
    const tenantId = getTenantId();
    const requestId = getRequestId();

    this.logger.log(`[${requestId}] Fetching invoices for tenant ${tenantId}`);

    const invoices = await this.invoicesService.findAll();

    this.logger.log(`[${requestId}] Found ${invoices.length} invoices for tenant ${tenantId}`);

    return invoices;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get invoice statistics for current tenant' })
  @ApiResponse({ status: 200, description: 'Invoice statistics' })
  async getStatistics(): Promise<{
    total: number;
    paid: number;
    pending: number;
    overdue: number;
    total_amount: number;
  }> {
    const tenantId = getTenantId();
    const requestId = getRequestId();

    this.logger.log(`[${requestId}] Fetching statistics for tenant ${tenantId}`);

    const stats = await this.invoicesService.getStatistics();

    this.logger.log(
      `[${requestId}] Stats for tenant ${tenantId}: ${stats.total} total, ${stats.total_amount} total amount`,
    );

    return stats;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID (tenant-scoped)' })
  @ApiResponse({ status: 200, description: 'Invoice details' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async findById(@Param('id') id: string): Promise<Invoice> {
    const tenantId = getTenantId();
    const requestId = getRequestId();

    this.logger.log(`[${requestId}] Fetching invoice ${id} for tenant ${tenantId}`);

    const invoice = await this.invoicesService.findById(id);

    this.logger.log(`[${requestId}] Found invoice ${id} for tenant ${tenantId}`);

    return invoice;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new invoice for current tenant' })
  @ApiResponse({ status: 201, description: 'Invoice created' })
  async create(
    @Body() dto: { invoice_number: string; customer_name: string; amount: number },
  ): Promise<Invoice> {
    const tenantId = getTenantId();
    const userId = getUserId();
    const requestId = getRequestId();

    this.logger.log(
      `[${requestId}] Creating invoice ${dto.invoice_number} for tenant ${tenantId} by user ${userId}`,
    );

    const invoice = await this.invoicesService.create(dto);

    this.logger.log(
      `[${requestId}] Created invoice ${invoice.id} (${invoice.invoice_number}) for tenant ${tenantId}`,
    );

    return invoice;
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update invoice status (tenant-scoped)' })
  @ApiResponse({ status: 200, description: 'Invoice updated' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async updateStatus(@Param('id') id: string, @Body() dto: { status: string }): Promise<Invoice> {
    const tenantId = getTenantId();
    const userId = getUserId();
    const requestId = getRequestId();

    this.logger.log(
      `[${requestId}] Updating invoice ${id} status to ${dto.status} for tenant ${tenantId} by user ${userId}`,
    );

    const invoice = await this.invoicesService.updateStatus(id, dto.status);

    this.logger.log(
      `[${requestId}] Updated invoice ${id} status to ${dto.status} for tenant ${tenantId}`,
    );

    return invoice;
  }
}
