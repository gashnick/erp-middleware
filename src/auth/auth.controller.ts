import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './types/login-response.type';

@ApiTags('Identity & Access')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Initial user signup (Public)' })
  @ApiResponse({ status: 201, description: 'User created without tenant.' })
  async register(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createPublicUser(createUserDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user and return JWT' })
  @ApiResponse({
    status: 200,
    description: 'Returns access_token and refresh_token.',
    type: LoginResponseDto, // This makes the "Example Value" appear in Swagger
  })
  // Change 'any' to 'LoginDto' here
  async login(@Body() loginDto: LoginDto) {
    // Now NestJS knows to look at LoginDto for Swagger docs
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    return this.authService.login(user);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Issue new JWT with tenant context after setup' })
  async refreshSession(@Request() req: ExpressRequest) {
    const user = req.user as any;
    return this.authService.generateTenantSession(user.id);
  }
}
