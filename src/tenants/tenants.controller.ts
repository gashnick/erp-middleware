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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { AuthService } from '../auth/auth.service'; // Ensure this path is correct
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Request as ExpressRequest } from 'express';

@ApiTags('Organization Management')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,

    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  /**
   * 🏗️ Setup Organization
   * This is a "Step-Up" operation. It takes a globally authenticated user,
   * creates their isolated infrastructure, and upgrades their session to a
   * Tenant-Scoped session.
   */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create organization and upgrade user to Tenant Admin' })
  @ApiResponse({
    status: 201,
    description: 'Tenant provisioned and new scoped JWT issued.',
  })
  async setupOrganization(@Request() req: ExpressRequest, @Body() dto: CreateTenantDto) {
    const user = req.user as any;
    const userId = user.id;

    try {
      // 1. Provision Infrastructure (Database Record + Schema + Migrations + Link User)
      // This is the atomic process we verified in your service.
      const result = await this.provisioningService.createOrganization(userId, dto);

      // 2. 🔑 Session Upgrade (The "Switch")
      // Now that the DB has the tenant_id linked to the user, we generate a
      // NEW token that contains the tenantId and schemaName in the payload.
      const session = await this.authService.generateTenantSession(userId);

      return {
        success: true,
        message: 'Infrastructure provisioned and session upgraded successfully',
        organization: {
          id: result.tenantId,
          name: dto.companyName,
          slug: result.slug,
          plan: result.plan,
        },
        // The frontend must replace its current token with these:
        auth: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        },
      };
    } catch (error) {
      // Logic for specific error handling (e.g., duplicate slugs) can be added here
      throw new InternalServerErrorException(
        error.message || 'Failed to complete organization setup',
      );
    }
  }

  /**
   * 📋 List All Organizations
   * Usually reserved for Platform Admins or internal diagnostics.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all registered organizations (Platform Admin)' })
  @ApiResponse({ status: 200, description: 'Return list of all tenants.' })
  async listAll() {
    return await this.provisioningService.findAll();
  }
}
