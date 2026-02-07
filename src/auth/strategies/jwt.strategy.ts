import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly tenantsService: TenantProvisioningService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // 🛡️ Dynamic Secret Lookup
      secretOrKeyProvider: async (request: any, rawJwtToken: any, done: any) => {
        try {
          try {
            // eslint-disable-next-line no-console
            console.log(
              '[JWT_STRATEGY] secretOrKeyProvider called. rawJwtToken type:',
              typeof rawJwtToken,
              'len:',
              rawJwtToken?.length || 0,
            );
          } catch (e) {
            // ignore
          }

          const decoded: any =
            typeof rawJwtToken === 'string'
              ? JSON.parse(Buffer.from(rawJwtToken.split('.')[1], 'base64').toString())
              : rawJwtToken;

          // Visible debug for E2E: show decoded token claims
          try {
            // eslint-disable-next-line no-console
            console.log(
              '[JWT_STRATEGY] Decoded token payload for secret lookup:',
              JSON.stringify(decoded),
            );
          } catch (e) {
            // ignore
          }

          // 1. If no tenantId, use the Global Secret (System Mode)
          if (!decoded.tenantId) {
            const globalSecret = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';
            // eslint-disable-next-line no-console
            console.log('[JWT_STRATEGY] No tenantId in token, using global secret');
            return done(null, globalSecret);
          }

          // 2. If tenantId exists, fetch and decrypt the Tenant Secret (Tenant Mode)
          const tenant = await this.tenantsService.findById(decoded.tenantId);
          if (!tenant) return done(new UnauthorizedException('Tenant not found'), null);

          const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;
          const plainSecret = this.encryptionService.decrypt(tenant.tenant_secret, masterKey);

          // Visible debug for E2E: indicate which tenant secret was retrieved
          try {
            // eslint-disable-next-line no-console
            console.log(
              `[JWT_STRATEGY] Resolved tenant secret for tenantId=${decoded.tenantId} (schema=${tenant.schema_name})`,
            );
          } catch (e) {
            // ignore
          }

          done(null, plainSecret);
        } catch (err) {
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
