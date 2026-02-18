import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Inject,
  forwardRef,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Request as ExpressRequest } from 'express';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create tenant and upgrade user to Tenant Admin' })
  @ApiResponse({ status: 201, description: 'Tenant provisioned and new scoped JWT issued.' })
  async create(@Request() req: ExpressRequest, @Body() dto: CreateTenantDto) {
    const user = req.user as any;
    const userId = user.id;

    try {
      const result = await this.provisioningService.createOrganization(userId, dto);
      const session = await this.authService.generateTenantSession(userId, result.tenantId);
      
      return {
        success: true,
        message: 'Tenant created successfully',
        tenantId: result.tenantId,
        schemaName: result.schemaName,
        organization: {
          id: result.tenantId,
          name: dto.companyName,
          slug: result.slug,
        },
        auth: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error.message || 'Failed to create tenant');
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async findOne(@Param('id') id: string) {
    return this.provisioningService.findById(id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all tenants' })
  async findAll() {
    return this.provisioningService.findAll();
  }
}

@ApiTags('Organization Management')
@Controller('tenants')
export class TenantsAliasController {}
