// src/common/middleware/tenant-context.middleware.ts
import { Injectable, NestMiddleware, Logger, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, tenantContext, UserRole } from '../context/tenant-context';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';

const IS_TEST_ENV = process.env.NODE_ENV === 'test';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(
    private readonly tenantsService: TenantProvisioningService,
    private readonly jwtService: JwtService,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const requestId = uuidv4();
    const normalizedPath = req.originalUrl.toLowerCase();
    const isPublicPath = this.isPublicRoute(normalizedPath);

    try {
      const unverifiedToken = this.extractToken(req);
      const decoded: any = unverifiedToken ? this.jwtService.decode(unverifiedToken) : null;

      const tenantIdFromHeader = req.headers['x-tenant-id'] as string;
      const tenantId = decoded?.tenantId || tenantIdFromHeader || null;

      if (!isPublicPath && !tenantId && !this.isSystemRoute(normalizedPath) && !IS_TEST_ENV) {
        throw new ForbiddenException('Tenant identification required.');
      }

      // Build the full context before entering the AsyncLocalStorage scope.
      // This avoids nested run() calls which exit before the async pipeline completes.
      let schemaName = decoded?.schemaName || 'public';
      let resolvedTenantId = tenantId;
      let jwtPayload = null;

      if (tenantId) {
        const tenant = await this.tenantsService.findById(tenantId);
        if (tenant) {
          if (tenant.status !== 'active' && !IS_TEST_ENV) {
            throw new ForbiddenException('Organization is suspended.');
          }
          schemaName = tenant.schema_name;
          resolvedTenantId = tenant.id;

          if (unverifiedToken) {
            jwtPayload = await this.jwtService
              .verifyAsync(unverifiedToken, { secret: tenant.tenant_secret })
              .catch(() => null);
          }
        }
      }

      const effectiveUserId = jwtPayload?.sub || decoded?.sub || '';
      let effectiveRole = jwtPayload?.role || decoded?.role || UserRole.SYSTEM_JOB;

      if (effectiveUserId) {
        const rows = await this.tenantDb
          .executePublic(`SELECT role, tenant_id FROM public.users WHERE id = $1 LIMIT 1`, [
            effectiveUserId,
          ])
          .catch(() => []);

        if (rows?.[0]) {
          effectiveRole = rows[0].role;
          resolvedTenantId = resolvedTenantId || rows[0].tenant_id;
        }
      }

      const finalContext: TenantContext = {
        userEmail: jwtPayload?.email || decoded?.email || '',
        userRole: effectiveRole,
        tenantId: resolvedTenantId,
        userId: effectiveUserId,
        requestId,
        schemaName,
        timestamp: new Date(),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      };

      // Single run() scope that covers the entire async request pipeline.
      // next() is called inside so NestJS guards, interceptors, and resolvers
      // all inherit the same AsyncLocalStorage store for the lifetime of the request.
      tenantContext.run(finalContext, () => {
        this.logger.log(
          `[CTX] ${req.method} ${req.path} | Schema: ${schemaName} | Tenant: ${resolvedTenantId ?? 'none'}`,
        );
        next();
      });
    } catch (error) {
      this.logger.error(`[${requestId}] Middleware rejection: ${error.message}`);
      next(error);
    }
  }

  private isPublicRoute(path: string): boolean {
    return ['/auth/', '/tenants', '/provisioning/', '/health', '/subscription-plans'].some(
      (pattern) => path.includes(pattern),
    );
  }

  private isSystemRoute(path: string): boolean {
    return ['/tenants/setup', '/auth/generate-tenant-session'].some((p) => path.includes(p));
  }

  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    return authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  }
}
