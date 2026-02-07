import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  Patch,
  Delete,
} from '@nestjs/common'; // Decorator
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { Request as ExpressRequest } from 'express'; // Type
import { getTenantContext, UserRole } from '@common/context/tenant-context';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('User Management')
@Controller('users')
@UseGuards(JwtAuthGuard, TenantContextGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Add a new member to the current organization' })
  async inviteUser(@Body() createUserDto: CreateUserDto) {
    const { tenantId, userRole } = getTenantContext();

    // Only ADMINs may invite/create new users
    if (userRole !== UserRole.ADMIN && userRole !== 'ADMIN') {
      throw new ForbiddenException('Insufficient privileges to invite users');
    }

    // 🛡️ Passing BOTH tenantId and the dto to match the service signature
    return this.usersService.create(tenantId || null, createUserDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and tenant info' })
  // Fix: Explicitly type req as ExpressRequest (or 'any' if necessary)
  async getProfile(@Request() req: ExpressRequest) {
    // Debug: log incoming auth header and tenant context presence for E2E
    try {
      // eslint-disable-next-line no-console
      console.log('[USERS_CONTROLLER] Authorization header:', req.headers['authorization']);
      // eslint-disable-next-line no-console
      console.log('[USERS_CONTROLLER] req.user:', JSON.stringify(req.user));
    } catch (e) {
      // ignore
    }

    // Note: Passport attaches the user to req.user
    const user = req.user as any;
    return this.usersService.findById(user.id);
  }

  @Get()
  @UseGuards()
  async listUsers() {
    const { tenantId } = getTenantContext();
    return this.usersService.listUsers(tenantId || undefined);
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  async updateUser(@Param('id') id: string, @Body() body: any) {
    const { tenantId, userRole } = getTenantContext();
    if (!tenantId) throw new Error('Tenant context required');
    // Only ADMIN may change roles
    if (body.role && userRole !== UserRole.ADMIN && userRole !== 'ADMIN') {
      throw new ForbiddenException('Insufficient privileges to change roles');
    }
    return this.usersService.update(tenantId, id, { fullName: body.fullName, role: body.role });
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    const { tenantId } = getTenantContext();
    if (!tenantId) throw new Error('Tenant context required');
    return this.usersService.delete(tenantId, id);
  }
}
