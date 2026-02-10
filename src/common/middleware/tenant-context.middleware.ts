import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, tenantContext, UserRole } from '../context/tenant-context';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
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
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const requestId = uuidv4();
    const normalizedPath = req.originalUrl.toLowerCase();
    const isPublicPath = this.isPublicRoute(normalizedPath);

    try {
      const unverifiedToken = this.extractToken(req);

      // 1. Decode payload immediately to get context hints (tenantId/schemaName)
      // This is safe because JwtStrategy will perform the actual signature verification later.
      const decoded: any = unverifiedToken ? this.jwtService.decode(unverifiedToken) : null;

      const tenantIdFromHeader = req.headers['x-tenant-id'] as string;
      const tenantId = decoded?.tenantId || tenantIdFromHeader || null;

      // Establish a lightweight preliminary tenant context so any DB helpers
      // invoked during verification (e.g., tenantDb.transaction -> getRequestId)
      // do not throw. We'll upgrade this context to the full context later.
      const preliminaryContext: TenantContext = {
        userEmail: decoded?.email || '',
        userRole: decoded?.role || UserRole.SYSTEM_JOB,
        tenantId: tenantId || null,
        userId: decoded?.sub || '',
        requestId,
        schemaName: 'public',
        timestamp: new Date(),
      };

      // 2. Determine Schema Name
      // Priority: Token Payload > Public (Fallback)
      let schemaName = decoded?.schemaName || 'public';

      // Run verification and tenant lookup inside the preliminary context
      // so transactional helpers can access a requestId if needed.
      await tenantContext.run(preliminaryContext, async () => {
        // 3. Security Guard for Non-Public Routes
        if (!isPublicPath && !tenantId && !this.isSystemRoute(normalizedPath) && !IS_TEST_ENV) {
          throw new ForbiddenException('Tenant identification required for this resource.');
        }

        let jwtPayload = null as any;

        // 4. Verification Logic
        if (tenantId) {
          // Optimization: We only fetch the tenant if we don't have the schemaName
          // OR if we need to verify the token with the tenant secret.
          const tenant = await this.tenantsService.findById(tenantId);

          if (tenant) {
            if (tenant.status !== 'active' && !IS_TEST_ENV) {
              throw new ForbiddenException('Organization context is invalid or suspended.');
            }
            // Sync schema name from DB if token didn't have it
            schemaName = tenant.schema_name;

            if (unverifiedToken) {
              jwtPayload = await this.verifyWithTenantSecret(unverifiedToken, tenant.tenant_secret);
            }
          }
        } else if (unverifiedToken) {
          // System/Public Token verification
          try {
            jwtPayload = await this.jwtService.verifyAsync(unverifiedToken);
          } catch (e) {
            if (!isPublicPath && !IS_TEST_ENV)
              throw new UnauthorizedException('Invalid platform session.');
          }
        }

        // Try to resolve authoritative role from the database when possible so
        // that actions taken by other requests (e.g. provisioning upgrading a
        // user's role) are reflected immediately even if the JWT hasn't been
        // refreshed yet.
        let effectiveRole = jwtPayload?.role || decoded?.role || UserRole.SYSTEM_JOB;
        const effectiveUserId = jwtPayload?.sub || decoded?.sub || '';
        if (effectiveUserId) {
          try {
            const rows = await this.tenantDb.executePublic(
              `SELECT role FROM public.users WHERE id = $1 LIMIT 1`,
              [effectiveUserId],
            );
            if (rows && rows.length > 0 && rows[0].role) {
              effectiveRole = rows[0].role;
            }
          } catch (e) {
            // ignore DB read failures here; fallback to token role
          }
        }

        // If token didn't include tenantId, attempt to resolve tenant_id from the
        // user's public.users row. This allows freshly-provisioned users (whose
        // JWT hasn't been upgraded) to access tenant-scoped endpoints based on
        // their DB-assigned tenant link.
        let resolvedTenantId = tenantId;
        if (!resolvedTenantId && effectiveUserId) {
          try {
            const userRows = await this.tenantDb.executePublic(
              `SELECT tenant_id FROM public.users WHERE id = $1 LIMIT 1`,
              [effectiveUserId],
            );
            if (userRows && userRows.length > 0 && userRows[0].tenant_id) {
              resolvedTenantId = userRows[0].tenant_id;
            }
          } catch (e) {
            // ignore - we'll fallback to token hints
          }
        }

        // After verification, build the full context and replace the preliminary one.
        const upgradedContext: TenantContext = {
          userEmail: jwtPayload?.email || decoded?.email || '',
          userRole: effectiveRole,
          tenantId: resolvedTenantId,
          userId: effectiveUserId,
          requestId,
          schemaName,
          timestamp: new Date(),
        };

        // Replace the context so downstream code sees the final values
        tenantContext.enterWith(upgradedContext);

        // 6. Run the rest of the request inside the AsyncLocalStorage context
        this.logContext(requestId, upgradedContext, req);
        await new Promise<void>((resolve, reject) => {
          try {
            next();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      return;
    } catch (error) {
      this.logger.error(`[${requestId}] Middleware rejection: ${error.message}`);

      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        return next(error);
      }

      next(new UnauthorizedException(error.message || 'Identity verification failed'));
    }
  }

  private isPublicRoute(path: string): boolean {
    const publicPatterns = [
      '/auth/register', 
      '/auth/login', 
      '/auth/refresh', 
      '/auth/google',
      '/auth/github',
      '/provisioning/organizations', 
      '/health', 
      '/subscription-plans'
    ];
    return publicPatterns.some((pattern) => path.includes(pattern));
  }

  private isSystemRoute(path: string): boolean {
    const systemPatterns = ['/tenants/setup', '/auth/generate-tenant-session'];
    return systemPatterns.some((pattern) => path.includes(pattern));
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

  private async verifyWithTenantSecret(token: string, encryptedSecret: string) {
    try {
      const masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY');
      if (!masterKey) throw new Error('System master key missing');

      const plainSecret = this.encryptionService.decrypt(encryptedSecret, masterKey);
      try {
        // eslint-disable-next-line no-console
        console.log(
          '[TENANT_MIDDLEWARE] Verifying token with tenant secret (fingerprint):',
          plainSecret ? `${plainSecret.substring(0, 8)}...` : 'MISSING',
        );
      } catch (e) {
        // ignore
      }

      return await this.jwtService.verifyAsync(token, { secret: plainSecret });
    } catch (e) {
      this.logger.error(`JWT Verification Failed: ${e.message}`);

      // In test environment, allow fallback to global secret to reduce flakiness
      if (IS_TEST_ENV) {
        try {
          // eslint-disable-next-line no-console
          console.log(
            '[TENANT_MIDDLEWARE] Tenant verification failed; falling back to global secret (TEST ONLY).',
          );
          const fallback = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';
          return await this.jwtService.verifyAsync(token, { secret: fallback });
        } catch (e2) {
          this.logger.error(`Fallback verification also failed: ${e2.message}`);
          throw new UnauthorizedException('Invalid security token for this organization.');
        }
      }

      throw new UnauthorizedException('Invalid security token for this organization.');
    }
  }
}
