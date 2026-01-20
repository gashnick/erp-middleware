import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common'; // Decorator
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantContextGuard } from '@common/guards/tenant-context.guard';
import { Request as ExpressRequest } from 'express'; // Type

@ApiTags('User Management')
@Controller('users')
@UseGuards(JwtAuthGuard, TenantContextGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Add a new member to the current organization' })
  async inviteUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and tenant info' })
  // Fix: Explicitly type req as ExpressRequest (or 'any' if necessary)
  async getProfile(@Request() req: ExpressRequest) {
    // Note: Passport attaches the user to req.user
    const user = req.user as any;
    return this.usersService.findById(user.id);
  }
}
