// src/auth/strategies/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly tenantsService: TenantProvisioningService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // 🛡️ Dynamic Secret Lookup
      secretOrKeyProvider: async (_request: any, rawJwtToken: any, done: any) => {
        try {
          const decoded: any =
            typeof rawJwtToken === 'string'
              ? JSON.parse(Buffer.from(rawJwtToken.split('.')[1], 'base64').toString())
              : rawJwtToken;

          // 1. System Mode: No tenantId (User hasn't selected a workspace yet)
          if (!decoded.tenantId) {
            const globalSecret = this.configService.get<string>('JWT_SECRET') || 'fallback';
            return done(null, globalSecret);
          }

          // 2. Tenant Mode: Fetch the pre-decrypted tenant secret
          // findById already handles the Master Key and decryption internally.
          const tenant = await this.tenantsService.findById(decoded.tenantId);

          if (!tenant || !tenant.tenant_secret) {
            return done(
              new UnauthorizedException('Tenant context invalid or secret missing'),
              null,
            );
          }

          // Successfully resolved the secret used to sign the tenant-specific JWT
          done(null, tenant.tenant_secret);
        } catch (err) {
          this.logger.error(`JWT Secret Provider Error: ${err.message}`);
          done(err, null);
        }
      },
    });
  }

  async validate(payload: any) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId || null,
      schemaName: payload.schemaName || 'public',
    };
  }
}
