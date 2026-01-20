import { Injectable, NestMiddleware, UnauthorizedException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, tenantContext } from '../context/tenant-context';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(
    private readonly tenantsService: TenantProvisioningService,
    private readonly jwtService: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const requestId = uuidv4();
    const normalizedPath = req.originalUrl.toLowerCase();
    const method = req.method;

    try {
      // 1. Identify "Global" routes (No tenant needed)
      const isPublicAuth =
        normalizedPath.includes('/auth/register') || normalizedPath.includes('/auth/login');
      const isTenantSetup = normalizedPath.includes('/tenants/setup') && method === 'POST';
      const isTokenRefresh = normalizedPath.includes('/auth/refresh');

      // 2. Decode JWT to get embedded context (The "Passport")
      const jwtPayload = this.decodeJwt(req);

      // Prioritize JWT data, fallback to header for legacy/testing
      const tenantId = jwtPayload?.tenantId || this.extractTenantFromHeader(req);
      const schemaInJwt = jwtPayload?.schemaName;

      // 3. Guard: If route is private and we have no tenant info, block it.
      if (!tenantId && !isPublicAuth && !isTenantSetup && !isTokenRefresh) {
        this.logger.error(`[${requestId}] Access denied: No tenant context for ${normalizedPath}`);
        throw new UnauthorizedException('Tenant context required.');
      }

      // 4. Resolve Schema Name
      let finalSchemaName = 'public';

      if (tenantId) {
        if (schemaInJwt) {
          // OPTIMIZATION: If schema is in JWT, use it directly (saves a DB query!)
          finalSchemaName = schemaInJwt;
        } else if (!isTenantSetup) {
          // FALLBACK: If not in JWT, verify against DB (e.g., first login or header use)
          const tenant = await this.tenantsService.findById(tenantId);
          if (!tenant || tenant.status.toLowerCase() !== 'active') {
            throw new UnauthorizedException('Organization is inactive or does not exist.');
          }
          finalSchemaName = tenant.schema_name;
        }
      }

      // 5. Build the AsyncLocalStorage Context
      const contextData: TenantContext = {
        tenantId: tenantId || '00000000-0000-0000-0000-000000000000',
        userId: jwtPayload?.sub || 'anonymous',
        requestId,
        schemaName: finalSchemaName,
        userEmail: jwtPayload?.email || 'unknown',
        userRole: jwtPayload?.role || 'guest',
        timestamp: new Date(),
      };

      // 6. Enter the Context
      tenantContext.run(contextData, () => {
        this.logContext(requestId, contextData, req);
        next();
      });
    } catch (error) {
      this.logger.error(`[${requestId}] Middleware error: ${error.message}`);
      next(error);
    }
  }

  private extractTenantFromHeader(req: Request): string | null {
    const id = req.headers['x-tenant-id'] as string;
    return id?.trim() || null;
  }

  private decodeJwt(req: Request): any {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return null;
      const token = authHeader.split(' ')[1];
      return this.jwtService.decode(token);
    } catch {
      return null;
    }
  }

  private logContext(requestId: string, context: TenantContext, req: Request) {
    this.logger.log(
      JSON.stringify({
        event: 'context_set',
        requestId,
        tenantId: context.tenantId,
        schemaName: context.schemaName,
        path: req.originalUrl,
        method: req.method,
      }),
    );
  }
}
