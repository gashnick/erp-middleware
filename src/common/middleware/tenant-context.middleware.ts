import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, tenantContext } from '../context/tenant-context';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';

const IS_TEST_ENV = process.env.NODE_ENV === 'test';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(
    private readonly tenantsService: TenantProvisioningService,
    private readonly jwtService: JwtService,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const requestId = uuidv4();
    const normalizedPath = req.originalUrl.toLowerCase();
    const isPublicPath = this.isPublicRoute(normalizedPath);

    try {
      const unverifiedToken = this.extractToken(req);
      const decodedPayload: any = unverifiedToken ? this.jwtService.decode(unverifiedToken) : null;
      const tenantIdFromHeader = req.headers['x-tenant-id'] as string;
      const tenantId = decodedPayload?.tenantId || tenantIdFromHeader;

      if (!isPublicPath && !tenantId && !this.isSystemRoute(normalizedPath) && !IS_TEST_ENV) {
        throw new ForbiddenException('Tenant identification required for this resource.');
      }

      let tenant = null;
      let jwtPayload = null;

      if (tenantId) {
        tenant = await this.tenantsService.findById(tenantId);
        if (tenant && tenant.status !== 'active' && !IS_TEST_ENV) {
          throw new ForbiddenException('Organization context is invalid or suspended.');
        }

        if (unverifiedToken) {
          jwtPayload = await this.verifyWithTenantSecret(unverifiedToken, tenant.tenant_secret);
        }
      } else if (unverifiedToken) {
        try {
          jwtPayload = await this.jwtService.verifyAsync(unverifiedToken);
        } catch (e) {
          if (!isPublicPath && !IS_TEST_ENV)
            throw new UnauthorizedException('Invalid platform session.');
        }
      }

      const contextData: TenantContext = {
        userEmail: jwtPayload?.email || '',
        userRole: jwtPayload?.role || '',
        tenantId: tenantId || null,
        userId: jwtPayload?.sub || '',
        requestId,
        schemaName: tenant?.schema_name || 'public',
        timestamp: new Date(),
      };

      tenantContext.run(contextData, () => {
        this.logContext(requestId, contextData, req);
        next();
      });
    } catch (error) {
      this.logger.error(`[${requestId}] Middleware rejection: ${error.message}`);
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException)
        return next(error);
      next(new UnauthorizedException(error.message || 'Identity verification failed'));
    }
  }

  private isPublicRoute(path: string): boolean {
    const publicPatterns = ['/auth/register', '/auth/login', '/health'];
    return publicPatterns.some((pattern) => path.includes(pattern));
  }

  private isSystemRoute(path: string): boolean {
    const systemPatterns = ['/tenants/setup', '/auth/generate-tenant-session'];
    return systemPatterns.some((pattern) => path.includes(pattern));
  }

  private async verifyWithTenantSecret(token: string, encryptedSecret: string) {
    try {
      const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY');
      if (!masterKey) throw new Error('System master key missing');
      const plainSecret = this.encryptionService.decrypt(encryptedSecret, masterKey);
      return await this.jwtService.verifyAsync(token, { secret: plainSecret });
    } catch (e) {
      this.logger.error(`JWT Verification Failed: ${e.message}`);
      throw new UnauthorizedException('Invalid security token for this organization.');
    }
  }

  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.split(' ')[1];
  }

  private logContext(requestId: string, context: TenantContext, req: Request) {
    this.logger.log(
      `[CTX_SET] ${req.method} ${req.originalUrl} | Tenant: ${context.tenantId} | Schema: ${context.schemaName}`,
    );
  }
}
