// src/common/guards/tenant-context.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasTenantContext, getTenantContext } from '../context/tenant-context';

/**
 * Tenant Context Guard
 *
 * Ensures tenant context is set before allowing request to proceed.
 *
 * Apply to controllers that require tenant isolation:
 * ```typescript
 * @Controller('invoices')
 * @UseGuards(JwtAuthGuard, TenantContextGuard)
 * export class InvoicesController { }
 * ```
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  private readonly logger = new Logger(TenantContextGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route is marked as public
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());

    if (isPublic) {
      return true;
    }

    // Verify tenant context exists
    if (!hasTenantContext()) {
      this.logger.error('CRITICAL: TenantContextGuard detected missing tenant context');
      throw new ForbiddenException('No tenant context. This request cannot be processed.');
    }

    const { tenantId, schemaName } = getTenantContext();
    this.logger.debug(`TenantContextGuard passed for tenant ${tenantId} (${schemaName})`);

    return true;
  }
}
