import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { getTenantContext } from '@common/context/tenant-context';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtStrategy

    console.log('🔍 Debug:', {
      hasUser: !!user,
      user,
      authHeader: request.headers.authorization,
    });
    // 1. Ensure the user is at least logged in
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    // 2. Check the Context (derived from Middleware/Headers/AsyncLocalStorage)
    const storageContext = getTenantContext();
    const contextTenantId = storageContext?.tenantId;

    // 🛡️ SECURITY RULE:
    // If the route is protected by this guard, the "Lobby" ID is not allowed.
    if (!contextTenantId || contextTenantId === '00000000-0000-0000-0000-000000000000') {
      throw new ForbiddenException(
        'Please select or create an organization to access this resource.',
      );
    }

    // 🛡️ CROSS-CHECK RULE:
    // Ensure the Tenant ID in the JWT matches the Tenant ID in the current Context.
    // This prevents a user from using a JWT for "Tenant A" to access "Tenant B"
    if (user.tenantId !== contextTenantId) {
      throw new ForbiddenException(
        'JWT context mismatch. Please re-authenticate with the correct organization.',
      );
    }

    return true;
  }
}
