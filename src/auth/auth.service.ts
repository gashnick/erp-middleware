import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async validateUser(email: string, pass: string, tenantIdHeader?: string): Promise<any> {
    // 1. Find User
    // We filter by email. Since emails are unique per tenant,
    // we should ideally filter by tenantId too if provided.
    const user = await this.usersService.findByEmail(email);

    // 2. Validate Tenant Scope (Crucial for Multi-tenancy)
    if (user && tenantIdHeader && user.tenant_id !== tenantIdHeader) {
      throw new UnauthorizedException('User does not belong to this tenant');
    }

    // 3. Check Password
    if (user && (await bcrypt.compare(pass, user.password_hash))) {
      const { password_hash, ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id, // CRITICAL: Embeds context in token
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        tenantId: user.tenant_id,
      },
    };
  }

  async generateTenantSession(userId: string) {
    // No more second argument error!
    const user = await this.usersService.findById(userId);

    if (!user.tenant_id) {
      throw new UnauthorizedException('User not linked to a tenant yet');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
      // Use the alias we created in the SQL query
      schemaName: user.schemaName || 'public',
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    // ... your token hashing and saving logic ...

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }
}
