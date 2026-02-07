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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Request as ExpressRequest } from 'express';

@ApiTags('Organization Management')
@Controller('provisioning') // 🔄 Synchronized with E2E
export class TenantsController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  @Post('organizations') // 🔄 Synchronized: POST /provisioning/organizations
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create organization and upgrade user to Tenant Admin' })
  @ApiResponse({ status: 201, description: 'Tenant provisioned and new scoped JWT issued.' })
  async setupOrganization(@Request() req: ExpressRequest, @Body() dto: CreateTenantDto) {
    const user = req.user as any;
    const userId = user.id;

    try {
      // 1. Provision Infrastructure
      const result = await this.provisioningService.createOrganization(userId, dto);

      // 2. 🔑 Session Upgrade
      const session = await this.authService.generateTenantSession(userId, result.tenantId);

      return {
        success: true,
        message: 'Infrastructure provisioned and session upgraded successfully',
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
      // Pass through NotFoundException (like invalid plans) so they return 404, not 500
      if (error instanceof NotFoundException) throw error;

      throw new InternalServerErrorException(
        error.message || 'Failed to complete organization setup',
      );
    }
  }

  // Backwards-compatible alias used by some integration tests
  @Post('/tenants/organizations') // POST /tenants/organizations
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Alias: Create organization and upgrade user to Tenant Admin' })
  async setupOrganizationAlias(@Request() req: ExpressRequest, @Body() dto: CreateTenantDto) {
    return this.setupOrganization(req, dto);
  }

  // NOTE: Some integration tests POST to /tenants/organizations — provide
  // a lightweight alias controller to satisfy those requests without
  // changing the existing provisioning base path.
}

@ApiTags('Organization Management')
@Controller('tenants')
export class TenantsAliasController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
  ) {}

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async setupOrganization(@Request() req: ExpressRequest, @Body() dto: CreateTenantDto) {
    // Reuse provisioning flow but avoid duplicating error mapping logic
    const user = req.user as any;
    const userId = user.id;

    const result = await this.provisioningService.createOrganization(userId, dto);
    const session = await this.authService.generateTenantSession(userId, result.tenantId);

    return {
      success: true,
      message: 'Infrastructure provisioned and session upgraded successfully',
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
  }

  @Get('organizations') // Changed to match the grouping
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all registered organizations' })
  async listAll() {
    return await this.provisioningService.findAll();
  }
}
