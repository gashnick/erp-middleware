// src/etl/controllers/quarantine.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  Query,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { EtlService } from './services/etl.service';
import { QuarantineService } from './services/quarantine.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { getTenantContext } from '@common/context/tenant-context';
import { Request } from 'express';
import { RetryRecordDto, BatchRetryDto } from './dto/quarantine-retry.dto';
import { SyncStatusDto } from './dto/sync-status.dto';
import { QuarantineFilterDto } from './dto/query-quarantine.dto';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    tenantId: string;
    role: string;
  };
}

@ApiTags('Quarantine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantContextGuard)
@Controller('quarantine')
export class QuarantineController {
  private readonly logger = new Logger(QuarantineController.name);
  private readonly DEFAULT_PAGE_SIZE = 10;
  private readonly MAX_PAGE_SIZE = 100;
  private readonly MAX_BATCH_RETRY_SIZE = 50;

  constructor(
    private readonly etlService: EtlService,
    private readonly quarantineService: QuarantineService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated quarantine records' })
  async getQuarantine(@Query() filter: QuarantineFilterDto) {
    const { tenantId } = getTenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const sanitizedFilter = {
      ...filter,
      limit: Math.min(filter.limit || this.DEFAULT_PAGE_SIZE, this.MAX_PAGE_SIZE),
      offset: filter.offset || 0,
    };

    const result = await this.quarantineService.getPaginated(tenantId, sanitizedFilter);

    return {
      data: result.data || [],
      total: result.total || 0,
      limit: sanitizedFilter.limit,
      offset: sanitizedFilter.offset,
    };
  }

  @Get('status')
  async getStatus() {
    const { tenantId } = getTenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    return await this.quarantineService.getSyncStatus(tenantId);
  }

  /**
   * REFACTOR NOTE: 'retryQuarantineRecord' now lives in QuarantineService
   * to keep ETL service slim.
   */
  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a single record' })
  async retryRecord(
    @Param('id') id: string,
    @Body() dto: RetryRecordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { tenantId } = getTenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context is required');

    this.logger.log(`Retrying record: ${id} for tenant ${tenantId}`);

    try {
      // Logic moved to QuarantineService which has direct access to the repository
      return await this.quarantineService.retryRecord(tenantId, id, dto.fixedData, req.user.id);
    } catch (error) {
      this.logger.error(`Retry failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * REFACTOR NOTE: 'retryQuarantineBatch' now lives in QuarantineService
   */
  @Post('batch-retry')
  @ApiOperation({ summary: 'Retry multiple records' })
  async retryBatch(@Body() dto: BatchRetryDto, @Req() req: AuthenticatedRequest) {
    const { tenantId } = getTenantContext();
    if (!tenantId) throw new BadRequestException('Tenant context is required');

    if (!dto.ids || dto.ids.length === 0) {
      throw new BadRequestException('At least one record ID must be provided');
    }

    if (dto.ids.length > this.MAX_BATCH_RETRY_SIZE) {
      throw new BadRequestException(`Exceeds max batch size of ${this.MAX_BATCH_RETRY_SIZE}`);
    }

    try {
      // Delegate to QuarantineService
      const result = await this.quarantineService.retryBatch(tenantId, dto.ids, req.user.id);

      this.logger.log(`Batch retry finished: ${result.succeeded} succeeded`);
      return result;
    } catch (error) {
      this.logger.error(`Batch retry failed: ${error.message}`);
      throw error;
    }
  }
}
