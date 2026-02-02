import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { getTenantContext } from '@common/context/tenant-context'; // 🛡️ Import context

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    // 🛡️ REFINEMENT: Pull from TenantContext instead of the raw request
    // This ensures consistency across the entire execution flow
    const { userRole } = getTenantContext();

    if (!userRole) {
      throw new ForbiddenException('User security context or role missing');
    }

    const hasPermission = requiredRoles.includes(userRole);

    if (!hasPermission) {
      throw new ForbiddenException(
        `Insufficient permissions. Required: [${requiredRoles.join(', ')}]. Found: [${userRole}]`,
      );
    }

    return true;
  }
}
