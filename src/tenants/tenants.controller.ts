import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard'; // Adjust path based on your structure
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Request as ExpressRequest } from 'express';

@ApiTags('Organization Management')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly provisioningService: TenantProvisioningService) {}

  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create organization and provision isolated schema' })
  @ApiResponse({
    status: 201,
    description: 'Tenant provisioned, subscription activated, and user promoted to Admin.',
  })
  async setupOrganization(
    @Request() req: ExpressRequest,
    @Body() dto: CreateTenantDto, // Use the DTO here
  ) {
    // req.user is populated by the JwtAuthGuard/Strategy
    const user = req.user as any;
    const userId = user.id;

    // This triggers the atomic transaction we built in the service
    const result = await this.provisioningService.createOrganization(userId, dto);

    return {
      message: 'Infrastructure and subscription provisioned successfully',
      ...result,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all registered organizations' })
  @ApiResponse({ status: 200, description: 'Return list of all tenants and their plans.' })
  async listAll() {
    return await this.provisioningService.findAll();
  }
}
