// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { InjectRepository } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantProvisioningService,
    private readonly encryptionService: EncryptionService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  /**
   * Validates credentials against the shared public users table
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);

    // Defensive check for bcryptjs:
    // It will throw if 'pass' or 'user.password_hash' are not strings.
    if (!user || typeof user.password_hash !== 'string') {
      return null;
    }

    const isMatch = await bcrypt.compare(pass, user.password_hash);

    if (isMatch) {
      const { password_hash, ...result } = user;
      return result;
    }

    return null;
  }

  /**
   * INITIAL LOGIN: System/Public level
   * Used for users without a tenant or as the first step of authentication.
   * Only generates access token - no refresh token for null tenant.
   */
  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: null,
      schemaName: 'public',
    };

    const accessToken = this.jwtService.sign(payload);
    
    // Don't generate refresh token for null tenant - user needs to create/join tenant first
    return {
      access_token: accessToken,
      user: { id: user.id, email: user.email, tenantId: null, role: user.role },
    };
  }

  /**
   * UNIVERSAL REFRESH
   * Only works for tenant JWTs since public sessions don't have refresh tokens
   */
  async refresh(token: string) {
    const isJwt = token.split('.').length === 3;

    if (isJwt) {
      return this.refreshTenantSession(token);
    }

    // Public sessions don't have refresh tokens - user must re-login
    throw new UnauthorizedException('Public sessions require re-authentication');
  }

  /**
   * TENANT SESSION ELEVATION
   * Generates tokens signed with the unique Tenant Secret.
   */
  async generateTenantSession(userId: string, tenantId?: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Use provided tenantId or fall back to user's tenant_id
    const effectiveTenantId = tenantId || user.tenant_id;
    if (!effectiveTenantId) {
      throw new UnauthorizedException('User not linked to a tenant');
    }

    const tenant = await this.tenantsService.findById(effectiveTenantId);
    if (!tenant) {
      throw new UnauthorizedException('Tenant not found');
    }

    const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;
    const decryptedSecret = this.encryptionService.decrypt(tenant.tenant_secret, masterKey);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: effectiveTenantId,
      schemaName: tenant.schema_name,
    };

    const access = this.jwtService.sign(payload, {
      secret: decryptedSecret,
      expiresIn: '1h',
    });

    const refresh = this.jwtService.sign(payload, {
      secret: decryptedSecret,
      expiresIn: '7d',
    });

    // Temporary debug logs to trace token payloads during E2E
    try {
      const decodedAccess = this.jwtService.decode(access) as any;
      const decodedRefresh = this.jwtService.decode(refresh) as any;
      this.logger.debug(`Generated tenant access token payload: ${JSON.stringify(decodedAccess)}`);
      this.logger.debug(
        `Generated tenant refresh token payload: ${JSON.stringify(decodedRefresh)}`,
      );
    } catch (e) {
      this.logger.warn(`Failed to decode generated tokens for debug: ${e.message}`);
    }

    return {
      access_token: access,
      refresh_token: refresh,
      user: {
        // Added user object
        id: user.id,
        email: user.email,
        tenantId: effectiveTenantId,
        role: user.role,
      },
    };
  }

  /** ==========================================================================
   * PRIVATE HELPERS
   * ========================================================================= */

  private async refreshTenantSession(refreshToken: string) {
    try {
      const decoded = this.jwtService.decode(refreshToken) as any;
      if (!decoded?.tenantId) throw new Error();

      const tenant = await this.tenantsService.findById(decoded.tenantId);
      const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;
      const secret = this.encryptionService.decrypt(tenant.tenant_secret, masterKey);

      const payload = await this.jwtService.verifyAsync(refreshToken, { secret });

      const newPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
        schemaName: payload.schemaName,
      };

      // Generate new refresh token
      const newRefreshToken = this.jwtService.sign(newPayload, {
        secret,
        expiresIn: '7d',
      });

      return {
        access_token: this.jwtService.sign(newPayload, { secret, expiresIn: '1h' }),
        refresh_token: newRefreshToken, // Added refresh_token
      };
    } catch (e) {
      this.logger.warn(`Tenant refresh attempt failed: ${e.message}`);
      throw new UnauthorizedException('Invalid tenant refresh token');
    }
  }
}
