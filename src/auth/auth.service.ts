// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import * as bcrypt from 'bcryptjs';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { Repository, DataSource } from 'typeorm';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantProvisioningService,
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly encryptionService: EncryptionService,
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Validates credentials against the shared public users table
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);

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

    return {
      access_token: accessToken,
      user: { id: user.id, email: user.email, tenantId: null, role: user.role },
    };
  }

  /**
   * OAuth2 Login/Registration
   */
  async oauthLogin(oauthUser: any) {
    const { email, provider, providerId, fullName, picture } = oauthUser;
    let user = await this.usersService.findByEmail(email);

    if (!user) {
      user = await this.usersService.create(null, {
        email,
        fullName,
        role: 'ADMIN' as any,
        password: 'oauth-no-password-' + Math.random().toString(36),
      });

      await this.tenantDb.executePublic(
        `UPDATE public.users SET oauth_provider = $1, oauth_provider_id = $2, profile_picture = $3, password_hash = NULL WHERE id = $4`,
        [provider, providerId, picture, user.id],
      );
      user = await this.usersService.findById(user.id);
    } else if (!user['oauth_provider']) {
      await this.tenantDb.executePublic(
        `UPDATE public.users SET oauth_provider = $1, oauth_provider_id = $2, profile_picture = $3 WHERE id = $4`,
        [provider, providerId, picture, user.id],
      );
      user = await this.usersService.findById(user.id);
    }

    return this.login(user);
  }

  async refresh(token: string) {
    if (token.split('.').length === 3) {
      return this.refreshTenantSession(token);
    }
    throw new UnauthorizedException('Public sessions require re-authentication');
  }

  /**
   * TENANT SESSION ELEVATION
   * FIXED: Uses pre-decrypted tenant.tenant_secret from TenantProvisioningService
   */
  async generateTenantSession(userId: string, tenantId?: string) {
    const userRows = await this.dataSource.query(
      `SELECT id, email, role, tenant_id FROM public.users WHERE id = $1`,
      [userId],
    );
    const user = userRows[0];

    if (!user) throw new UnauthorizedException('User not found');

    const effectiveTenantId = tenantId || user.tenant_id;
    if (!effectiveTenantId) throw new UnauthorizedException('User not linked to a tenant');

    const tenant = await this.tenantsService.findById(effectiveTenantId);
    if (!tenant) throw new UnauthorizedException('Tenant not found');

    // Logic Fix: findById now returns the raw secret, no manual decryption needed here
    const jwtSecret = tenant.tenant_secret;

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: effectiveTenantId,
      schemaName: tenant.schema_name,
    };

    return {
      access_token: this.jwtService.sign(payload, { secret: jwtSecret, expiresIn: '1h' }),
      refresh_token: this.jwtService.sign(payload, { secret: jwtSecret, expiresIn: '7d' }),
      user: {
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
      if (!tenant) throw new Error('Tenant for session no longer exists');

      // Uses pre-decrypted secret
      const secret = tenant.tenant_secret;

      const payload = await this.jwtService.verifyAsync(refreshToken, { secret });

      const newPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
        schemaName: payload.schemaName,
      };

      return {
        access_token: this.jwtService.sign(newPayload, { secret, expiresIn: '1h' }),
        refresh_token: this.jwtService.sign(newPayload, { secret, expiresIn: '7d' }),
      };
    } catch (e) {
      this.logger.warn(`Tenant refresh failed: ${e.message}`);
      throw new UnauthorizedException('Invalid tenant refresh token');
    }
  }
}
