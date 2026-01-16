// src/common/middleware/tenant-context.middleware.ts
import { Injectable, NestMiddleware, UnauthorizedException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantContext } from '../context/tenant-context';
import { TenantsService } from '../../tenants/tenants.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Tenant Context Middleware
 *
 * CRITICAL COMPONENT: Sets up tenant context for every request BEFORE authentication.
 *
 * Priority order (fail-fast if any fails):
 * 1. Check X-Tenant-ID header (for tenant creation or public endpoints)
 * 2. Extract from JWT payload (already verified by AuthGuard)
 * 3. Validate tenant exists and is active
 * 4. Set AsyncLocalStorage context with role switching
 * 5. Log context switch for audit
 * 6. Execute request with context
 *
 * This middleware MUST run BEFORE authentication to support tenant creation.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(private readonly tenantsService: TenantsService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const requestId = uuidv4();

    try {
      // Step 1: Try to get tenant from header first (for tenant creation or public endpoints)
      let tenantId = this.extractTenantFromHeader(req);

      // Step 2: If not in header, try JWT (set by JwtAuthGuard if it ran)
      if (!tenantId) {
        const user = req.user as
          | {
              userId: string;
              tenantId: string;
              email: string;
              role: string;
            }
          | undefined;

        if (user?.tenantId) {
          tenantId = user.tenantId;
        }
      }

      // Step 3: Fail fast if no tenant context
      if (!tenantId) {
        this.logger.error(`[${requestId}] No tenant context found in header or JWT`);
        throw new UnauthorizedException(
          'Tenant context required. Provide X-Tenant-ID header or valid JWT with tenantId.',
        );
      }

      // Step 4: Validate tenant exists and is active (skip validation for tenant creation)
      let tenant;
      const isTenantCreation = req.path === '/tenants' && req.method === 'POST';

      if (!isTenantCreation) {
        try {
          tenant = await this.tenantsService.findById(tenantId);
        } catch (error) {
          this.logger.error(`[${requestId}] Tenant ${tenantId} not found`, error.stack);
          throw new UnauthorizedException('Tenant not found or inactive');
        }

        if (tenant.status !== 'active') {
          this.logger.warn(
            `[${requestId}] Attempt to access inactive tenant: ${tenant.id} (${tenant.status})`,
          );
          throw new UnauthorizedException(`Tenant is ${tenant.status}. Access denied.`);
        }
      } else {
        // For tenant creation, we don't have a tenant record yet
        tenant = null;
      }

      // Step 5: Extract user info (may not exist for tenant creation)
      const user = req.user as
        | {
            userId: string;
            tenantId: string;
            email: string;
            role: string;
          }
        | undefined;

      // Step 6: Set tenant context for this request
      const contextData = {
        tenantId,
        userId: user?.userId || 'system', // Default for tenant creation
        requestId,
        schemaName: tenant?.schemaName || `tenant_${tenantId.replace(/-/g, '')}`, // For tenant creation
        userEmail: user?.email || 'system',
        userRole: user?.role || 'system',
        timestamp: new Date(),
      };

      tenantContext.run(contextData, () => {
        // Step 7: Log context switch (critical for audit)
        this.logger.log(
          JSON.stringify({
            event: 'tenant_context_set',
            requestId,
            tenantId,
            userId: contextData.userId,
            schemaName: contextData.schemaName,
            source: tenantId === this.extractTenantFromHeader(req) ? 'header' : 'jwt',
            method: req.method,
            path: req.path,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          }),
        );

        // Step 8: Continue request with context set
        next();
      });
    } catch (error) {
      // Log and re-throw
      this.logger.error(
        `[${requestId}] Tenant context middleware failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Extract tenant ID from X-Tenant-ID header
   */
  private extractTenantFromHeader(req: Request): string | null {
    const tenantId = req.headers['x-tenant-id'] as string;
    return tenantId && tenantId.trim() ? tenantId.trim() : null;
  }
}
