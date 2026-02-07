import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { EtlService } from './services/etl.service';
import { QuarantineService } from './services/quarantine.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { getTenantContext } from '@common/context/tenant-context';

@ApiTags('ETL')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantContextGuard)
@Controller('etl')
export class EtlController {
  private readonly jobs = new Map<string, any>();

  constructor(
    private readonly etlService: EtlService,
    private readonly quarantine: QuarantineService,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(@Body() body: { source: string; entityType: string; records: any[] }) {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.jobs.set(jobId, { status: 'processing', totalRecords: body.records?.length ?? 0 });

    // Run ETL in background
    (async () => {
      try {
        const tenantId = ctx.tenantId!; // already validated above
        const result = await this.etlService.runInvoiceEtl(
          tenantId,
          body.records || [],
          body.source || 'csv_upload',
        );
        this.jobs.set(jobId, {
          status: 'completed',
          totalRecords: result.total || body.records.length,
          result,
        });
      } catch (err) {
        this.jobs.set(jobId, { status: 'failed', error: err.message });
      }
    })();

    return { jobId, status: 'processing', totalRecords: body.records?.length ?? 0 };
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  @Get('quarantine')
  async getQuarantine() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');
    const result = await this.quarantine.getPaginated(ctx.tenantId, {} as any);
    return { data: result.data ?? [], total: result.total ?? 0 };
  }
}
