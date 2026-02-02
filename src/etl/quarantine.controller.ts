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

/**
 * Authenticated Request Interface
 *
 * Extends Express Request with authenticated user information.
 */
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    tenantId: string;
    role: string;
  };
}

/**
 * Quarantine Controller
 *
 * Manages quarantined records (invalid data that failed ETL validation).
 *
 * Key Responsibilities:
 * - List quarantined records with pagination and filtering
 * - Provide ETL health metrics (sync status, error rates)
 * - Enable manual retry of corrected records
 * - Support batch retry operations
 *
 * Design Principles:
 * - Separation of Concerns: Service layer handles business logic
 * - Clear Response Formats: Consistent API contract
 * - Comprehensive Validation: Input validation before processing
 * - Observability: Detailed logging for troubleshooting
 */
@ApiTags('Quarantine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantContextGuard)
@Controller('quarantine')
export class QuarantineController {
  private readonly logger = new Logger(QuarantineController.name);

  // Pagination limits
  private readonly DEFAULT_PAGE_SIZE = 10;
  private readonly MAX_PAGE_SIZE = 100;
  private readonly MAX_BATCH_RETRY_SIZE = 50;

  constructor(
    private readonly etlService: EtlService,
    private readonly quarantineService: QuarantineService,
  ) {}

  /**
   * Retrieves paginated list of quarantine records.
   *
   * Supports filtering by:
   * - source: Data source type (e.g., 'csv_upload', 'quickbooks')
   * - status: Record status (e.g., 'pending', 'retrying')
   * - limit: Page size (default: 10, max: 100)
   * - offset: Pagination offset
   *
   * @param filter - Query parameters for filtering and pagination
   * @returns Paginated quarantine records with total count
   */
  @Get()
  @ApiOperation({ summary: 'Get paginated quarantine records with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Returns a paginated list of quarantine records.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'number' },
      },
    },
  })
  async getQuarantine(@Query() filter: QuarantineFilterDto) {
    const { tenantId } = getTenantContext();

    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    // Apply pagination defaults and limits
    const sanitizedFilter = {
      ...filter,
      limit: Math.min(filter.limit || this.DEFAULT_PAGE_SIZE, this.MAX_PAGE_SIZE),
      offset: filter.offset || 0,
    };

    this.logger.log(
      `Fetching quarantine records: tenant=${tenantId}, ` +
        `source=${sanitizedFilter.source || 'all'}, ` +
        `limit=${sanitizedFilter.limit}, offset=${sanitizedFilter.offset}`,
    );

    // Fetch paginated data from service
    const result = await this.quarantineService.getPaginated(tenantId, sanitizedFilter);

    // Ensure consistent response format
    return {
      data: result.data || [],
      total: result.total || 0,
      limit: sanitizedFilter.limit,
      offset: sanitizedFilter.offset,
    };
  }

  /**
   * Retrieves ETL health status and sync metrics.
   *
   * Provides overview of:
   * - Total invoices successfully synced
   * - Total records in quarantine
   * - Health percentage (synced / total processed)
   * - Latest activity timestamp
   *
   * @returns Sync status summary
   */
  @Get('status')
  @ApiOperation({ summary: 'Get a summary of ETL health and record counts' })
  @ApiResponse({
    status: 200,
    type: SyncStatusDto,
    description: 'Returns ETL sync status and health metrics.',
  })
  async getStatus() {
    const { tenantId } = getTenantContext();

    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    this.logger.log(`Fetching sync status for tenant ${tenantId}`);

    const status = await this.quarantineService.getSyncStatus(tenantId);

    return status;
  }

  /**
   * Retries a single quarantine record with corrected data.
   *
   * Workflow:
   * 1. Fetch original quarantine record by ID
   * 2. Apply user-provided corrections
   * 3. Re-run ETL validation
   * 4. If valid: Move to invoices table and delete from quarantine
   * 5. If invalid: Return validation errors
   *
   * @param id - Quarantine record identifier
   * @param dto - Corrected data to retry
   * @param req - Authenticated request with user info
   * @returns Success status and created invoice
   */
  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a single quarantine record with corrected data' })
  @ApiResponse({
    status: 200,
    description: 'Record successfully validated and moved to production.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        invoice: { type: 'object' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Corrected data still fails validation.',
  })
  async retryRecord(
    @Param('id') id: string,
    @Body() dto: RetryRecordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { tenantId } = getTenantContext();

    // Validation: Tenant context
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    // Validation: Record ID
    if (!id || id.trim() === '') {
      throw new BadRequestException('Quarantine record ID is required');
    }

    // Validation: Fixed data
    if (!dto.fixedData || typeof dto.fixedData !== 'object') {
      throw new BadRequestException('Fixed data must be a valid object');
    }

    this.logger.log(
      `Retrying quarantine record: tenant=${tenantId}, recordId=${id}, userId=${req.user.id}`,
    );

    try {
      const result = await this.etlService.retryQuarantineRecord(
        tenantId,
        id,
        dto.fixedData,
        req.user.id,
      );

      this.logger.log(
        `Quarantine retry succeeded: tenant=${tenantId}, recordId=${id}, ` +
          `invoiceId=${result.invoice.external_id}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Quarantine retry failed: tenant=${tenantId}, recordId=${id}, error=${error.message}`,
      );
      throw error; // Re-throw for proper HTTP status code
    }
  }

  /**
   * Retries multiple quarantine records in batch.
   *
   * Uses existing raw_data from quarantine records (no corrections applied).
   * Useful for retrying records after fixing a systemic validation issue.
   *
   * Workflow:
   * 1. Fetch all specified quarantine records
   * 2. Re-run ETL validation on original raw_data
   * 3. Move valid records to invoices, keep invalid in quarantine
   * 4. Return statistics: total processed, succeeded, failed
   *
   * @param dto - Array of quarantine record IDs to retry
   * @param req - Authenticated request with user info
   * @returns Batch retry statistics
   */
  @Post('batch-retry')
  @ApiOperation({ summary: 'Retry multiple quarantine records using their existing raw_data' })
  @ApiBody({ type: BatchRetryDto })
  @ApiResponse({
    status: 200,
    description: 'Batch retry completed.',
    schema: {
      type: 'object',
      properties: {
        totalProcessed: { type: 'number' },
        succeeded: { type: 'number' },
        failed: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  async retryBatch(@Body() dto: BatchRetryDto, @Req() req: AuthenticatedRequest) {
    const { tenantId } = getTenantContext();

    // Validation: Tenant context
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    // Validation: IDs array
    if (!dto.ids || !Array.isArray(dto.ids)) {
      throw new BadRequestException('IDs must be provided as an array');
    }

    if (dto.ids.length === 0) {
      throw new BadRequestException('At least one record ID must be provided');
    }

    if (dto.ids.length > this.MAX_BATCH_RETRY_SIZE) {
      throw new BadRequestException(
        `Batch size ${dto.ids.length} exceeds maximum allowed ${this.MAX_BATCH_RETRY_SIZE}`,
      );
    }

    // Validation: All IDs are strings
    const invalidIds = dto.ids.filter((id) => typeof id !== 'string' || id.trim() === '');
    if (invalidIds.length > 0) {
      throw new BadRequestException('All IDs must be non-empty strings');
    }

    this.logger.log(
      `Batch retry initiated: tenant=${tenantId}, count=${dto.ids.length}, userId=${req.user.id}`,
    );

    try {
      const result = await this.etlService.retryQuarantineBatch(tenantId, dto.ids, req.user.id);

      this.logger.log(
        `Batch retry completed: tenant=${tenantId}, ` +
          `processed=${result.totalProcessed}, succeeded=${result.succeeded}, ` +
          `failed=${result.failed.length}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Batch retry failed: tenant=${tenantId}, error=${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
