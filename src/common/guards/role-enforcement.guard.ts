// src/common/guards/role-enforcement.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getTenantContext, UserRole } from '@common/context/tenant-context';

/**
 * Role-Based Access Control Guard
 *
 * Enforces privilege minimization by checking user role against required role.
 * 🛡️ CRITICAL: Use on any endpoint that requires specific capabilities.
 *
 * @example
 * @UseGuards(RoleEnforcementGuard)
 * @RequireRole(UserRole.ADMIN) // Only ADMIN can access
 * async migrateSchema() { }
 *
 * @example
 * @UseGuards(RoleEnforcementGuard)
 * @RequireRole(UserRole.SYSTEM_MIGRATION) // Only migration system can access
 * async runMigration() { }
 */
@Injectable()
export class RoleEnforcementGuard implements CanActivate {
  private readonly logger = new Logger(RoleEnforcementGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.get<string>('requiredRole', context.getHandler());

    // If no role requirement, allow access
    if (!requiredRole) {
      return true;
    }

    try {
      const { userRole, userId } = getTenantContext();

      // Check if user role matches required role
      if (userRole !== requiredRole) {
        this.logger.warn(
          `RBAC violation: User ${userId} attempted access with role ${userRole}, but ${requiredRole} required`,
        );
        throw new ForbiddenException(`Insufficient privileges. Required role: ${requiredRole}`);
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // Context missing or other error
      throw new ForbiddenException('Unable to verify user role');
    }
  }
}
