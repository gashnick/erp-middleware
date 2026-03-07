import {
  Controller,
  Post,
  UseGuards,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { EtlService, EntityType } from './services/etl.service';
import { QuarantineService } from './services/quarantine.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { getTenantContext } from '@common/context/tenant-context';
import * as csv from 'csv-parse/sync';
import 'multer';
import { GraphBuilderService } from '../knowledgeGraph/graph-builder.service';

@ApiTags('Connectors & ETL')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantContextGuard)
@Controller('connectors')
export class EtlController {
  private readonly jobs = new Map<string, any>();

  constructor(
    private readonly etlService: EtlService,
    private readonly quarantine: QuarantineService,
    private readonly graphBuilder: GraphBuilderService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // CSV Upload Endpoint
  // POST /connectors/csv-upload
  // ─────────────────────────────────────────────────────────────

  @Post('csv-upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(
    @UploadedFile() file: Express.Multer.File,
    @Body('entityType') entityType: EntityType,
  ) {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');

    if (!file) throw new BadRequestException('CSV file is required');
    if (!entityType)
      throw new BadRequestException(
        'entityType is required. Must be one of: invoice, contact, expense, bank_transaction, product',
      );

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.jobs.set(jobId, {
      status: 'processing',
      entityType,
      filename: file.originalname,
    });

    (async () => {
      try {
        const records = csv.parse(file.buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
        if (!ctx.tenantId) throw new BadRequestException('Tenant context required');
        const result = await this.etlService.runEtl(
          ctx.tenantId,
          records,
          'csv_upload',
          entityType,
        );

        this.jobs.set(jobId, {
          status: 'completed',
          total: result.total,
          synced: result.synced,
          quarantined: result.quarantined,
        });

        // Rebuild knowledge graph after any ETL upload — fire and forget.
        // Contacts and expenses just changed so entity relationships need refresh.
        // Non-fatal — a KG build failure never affects the ETL result.
        this.graphBuilder
          .buildForTenant(ctx.tenantId, ctx.schemaName)
          .catch((err) =>
            console.error(
              `[KG] Post-ETL graph build failed for tenant ${ctx.tenantId}: ${err.message}`,
            ),
          );
      } catch (err) {
        this.jobs.set(jobId, {
          status: 'failed',
          error: err.message,
        });
      }
    })();

    return {
      jobId,
      status: 'processing',
      message: 'CSV upload started',
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Job Status Endpoint
  // GET /connectors/jobs/:id
  // ─────────────────────────────────────────────────────────────

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // ─────────────────────────────────────────────────────────────
  // Quarantine Records
  // GET /connectors/quarantine
  // ─────────────────────────────────────────────────────────────

  @Get('quarantine')
  async getQuarantine() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');

    const result = await this.quarantine.getPaginated(ctx.tenantId, {
      limit: 50,
      offset: 0,
    } as any);

    return {
      data: result.data ?? [],
      total: result.total ?? 0,
    };
  }

  @Post('build-graph')
  @HttpCode(HttpStatus.ACCEPTED)
  async buildGraph() {
    const ctx = getTenantContext();
    if (!ctx?.tenantId) throw new BadRequestException('Tenant context required');

    // Fire and forget — client polls /connectors/jobs/:id if they need status
    this.graphBuilder
      .buildForTenant(ctx.tenantId, ctx.schemaName)
      .catch((err) => console.error(`[KG] Manual graph build failed: ${err.message}`));

    return { message: 'Knowledge graph build started' };
  }
}
