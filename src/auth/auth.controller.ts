// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
  UnauthorizedException,
  Get,
  Res,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { GoogleOAuthGuard, GithubOAuthGuard } from './guards/oauth.guard';
import { LoginDto } from './dto/login.dto';
import { Request as ExpressRequest, Response } from 'express';

@ApiTags('Identity & Access')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Initial user signup (Public)' })
  @ApiResponse({ status: 201, description: 'User created without tenant context.' })
  async register(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createPublicUser(createUserDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login to system' })
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // 🛡️ Logic: If user already belongs to a tenant, jump straight to tenant session.
    // Otherwise, issue a public-scoped token for organization setup.
    if (user.tenant_id) {
      return this.authService.generateTenantSession(user.id);
    }

    return this.authService.login(user);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    // Note: The service should differentiate between JWT-based (tenant)
    // and DB-based (public) refresh tokens.
    return this.authService.refresh(refreshToken);
  }

  @Post('promote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elevate session to tenant scope after provisioning' })
  async promote(@Request() req: ExpressRequest) {
    const user = req.user as any;
    // generateTenantSession verifies that the user record now contains a tenant_id
    return this.authService.generateTenantSession(user.id);
  }

  // OAuth2 Routes
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth2 login' })
  async googleAuth() {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  async googleAuthCallback(@Req() req: ExpressRequest, @Res() res: Response) {
    const result = await this.authService.oauthLogin(req.user);
    
    // Return JSON response instead of redirect (no frontend)
    return res.json({
      success: true,
      message: 'Google authentication successful',
      access_token: result.access_token,
      user: result.user,
    });
  }

  @Get('github')
  @UseGuards(GithubOAuthGuard)
  @ApiOperation({ summary: 'Initiate GitHub OAuth2 login' })
  async githubAuth() {
    // Guard redirects to GitHub
  }

  @Get('github/callback')
  @UseGuards(GithubOAuthGuard)
  @ApiOperation({ summary: 'GitHub OAuth2 callback' })
  async githubAuthCallback(@Req() req: ExpressRequest, @Res() res: Response) {
    const result = await this.authService.oauthLogin(req.user);
    
    // Return JSON response instead of redirect (no frontend)
    return res.json({
      success: true,
      message: 'GitHub authentication successful',
      access_token: result.access_token,
      user: result.user,
    });
  }
}
