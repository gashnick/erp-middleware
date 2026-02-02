import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { Request as ExpressRequest } from 'express';

@ApiTags('Identity & Access')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /** ===================
   * Public Registration
   * =================== */
  @Post('register')
  @ApiOperation({ summary: 'Initial user signup (Public)' })
  @ApiResponse({ status: 201, description: 'User created without tenant.' })
  async register(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createPublicUser(createUserDto);
  }

  /** ===================
   * System Login
   * =================== */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user and return JWT' })
  @ApiResponse({
    status: 200,
    description: 'Returns access_token and refresh_token.',
  })
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login(user);
  }

  /** ===================
   * Refresh Session
   * =================== */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    return this.authService.refresh(refreshToken);
  }

  /** ===================
   * Tenant Promotion
   * =================== */
  @Post('promote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Promote a system-level user to tenant-level session' })
  async promote(@Request() req: ExpressRequest) {
    const user = req.user as any;
    if (!user?.id) {
      throw new UnauthorizedException('Invalid user session');
    }

    return this.authService.generateTenantSession(user.id);
  }
}
