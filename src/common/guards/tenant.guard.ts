import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
  hasTenantContext,
  getTenantContext,
  runWithTenantContext,
} from '@common/context/tenant-context';

@Injectable()
export class TenantGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Extract request based on context type
    let request: any;
    if (context.getType<string>() === 'graphql') {
      request = GqlExecutionContext.create(context).getContext().req;
    } else {
      request = context.switchToHttp().getRequest();
    }

    const user = request?.user; // Populated by JwtAuthGuard/Strategy

    // 2. Ensure the user is authenticated
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    // 3. Read tenant identity directly from req.user — always reliable.
    // AsyncLocalStorage may be empty in GraphQL resolver scope depending on
    // how Apollo schedules execution relative to the middleware async chain.
    const userTenantId = user.tenantId;
    const userSchemaName = user.schemaName || 'public';

    // 🛡️ SECURITY: No empty or null tenant IDs
    if (!userTenantId || userTenantId === '00000000-0000-0000-0000-000000000000') {
      throw new ForbiddenException(
        'Please select or create an organization to access this resource.',
      );
    }

    // 4. If AsyncLocalStorage context is already set (HTTP path through middleware),
    // verify it matches the JWT to catch token/context mismatches.
    if (hasTenantContext()) {
      const storageContext = getTenantContext();
      if (storageContext.tenantId && storageContext.tenantId !== userTenantId) {
        throw new ForbiddenException(
          'JWT context mismatch. Please re-authenticate with the correct organization.',
        );
      }
    } else {
      // 5. Context not set (GraphQL path bypassed middleware) — set it now
      // from the JWT payload so downstream services (TenantQueryRunnerService,
      // ChatService, etc.) can read it via getTenantContext().
      //
      // We use runWithTenantContext but we need it to persist for the rest of
      // the request, so we set it on the request object for the resolver to
      // re-enter if needed. The simplest approach: attach it to req so the
      // GraphQL module context has it available.
      request.__tenantContextSet = true;
      request.__tenantContext = {
        tenantId: userTenantId,
        schemaName: userSchemaName,
        userId: user.sub,
        userRole: user.role,
        userEmail: user.email,
      };
    }

    console.log('🔍 TenantGuard Debug:', {
      hasUser: !!user,
      userTenant: userTenantId,
      type: context.getType(),
      contextSource: hasTenantContext() ? 'AsyncLocalStorage' : 'JWT',
    });

    return true;
  }
}
