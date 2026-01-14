import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/create-tenant.dto';
import { Tenant } from './entities/tenant.entity';

/**
 * Tenants Controller
 *
 * REST API endpoints for tenant management.
 *
 * Code Complete Principle: Controllers are thin - delegate to services
 */

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * Create a new tenant
   *
   * POST /tenants
   *
   * This creates:
   * 1. Tenant record in public.tenants
   * 2. Tenant schema with all tables
   */
  @Post()
  @ApiOperation({
    summary: 'Create new tenant',
    description: 'Creates tenant record and database schema',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Tenant created successfully',
    type: Tenant,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input or schema creation failed',
  })
  async create(@Body() dto: CreateTenantDto): Promise<Tenant> {
    return this.tenantsService.create(dto);
  }

  /**
   * Get all tenants
   *
   * GET /tenants
   */
  @Get()
  @ApiOperation({
    summary: 'Get all tenants',
    description: 'Returns list of all active tenants',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of tenants',
    type: [Tenant],
  })
  async findAll(): Promise<Tenant[]> {
    return this.tenantsService.findAll();
  }

  /**
   * Get tenant by ID
   *
   * GET /tenants/:id
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get tenant by ID',
    description: 'Returns single tenant details',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tenant found',
    type: Tenant,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Tenant not found',
  })
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<Tenant> {
    return this.tenantsService.findById(id);
  }

  /**
   * Update tenant
   *
   * PATCH /tenants/:id
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update tenant',
    description: 'Update tenant information (partial update)',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tenant updated',
    type: Tenant,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Tenant not found',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<Tenant> {
    return this.tenantsService.update(id, dto);
  }

  /**
   * Soft delete tenant
   *
   * DELETE /tenants/:id
   *
   * Sets deleted_at timestamp. Tenant can be restored.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft delete tenant',
    description: 'Marks tenant as deleted (can be restored)',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Tenant soft deleted',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Tenant not found',
  })
  async softDelete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tenantsService.softDelete(id);
  }

  /**
   * Get tenant statistics
   *
   * GET /tenants/:id/statistics
   */
  @Get(':id/statistics')
  @ApiOperation({
    summary: 'Get tenant statistics',
    description: 'Returns tenant details and data statistics',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tenant statistics',
  })
  async getStatistics(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.getStatistics(id);
  }

  /**
   * Verify tenant schema
   *
   * GET /tenants/:id/verify-schema
   */
  @Get(':id/verify-schema')
  @ApiOperation({
    summary: 'Verify tenant schema',
    description: 'Checks if all expected tables exist in tenant schema',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Schema verification result',
  })
  async verifySchema(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.verifySchema(id);
  }

  /**
   * Count tenants by status
   *
   * GET /tenants/statistics/count-by-status
   */
  @Get('statistics/count-by-status')
  @ApiOperation({
    summary: 'Count tenants by status',
    description: 'Returns counts of tenants per status',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tenant counts',
  })
  async countByStatus() {
    return this.tenantsService.countByStatus();
  }
}
