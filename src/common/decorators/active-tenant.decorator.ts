// src/common/decorators/active-tenant.decorator.ts
import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { getTenantContext, TenantContext } from '@common/context/tenant-context';

/**
 * 🛡️ CRITICAL: Extracts tenant information from context ONLY.
 *
 * Tenant ID must NEVER come from user input (params, body, query).
 * User input is completely ignored by this decorator.
 *
 * @param data - Field to extract from TenantContext (e.g., 'id' for tenantId, 'userId', etc.)
 * @returns Value from authenticated context
 * @throws ForbiddenException if context is missing
 */
export const ActiveTenant = createParamDecorator(
  (data: keyof TenantContext | 'id' | undefined, ctx: ExecutionContext) => {
    try {
      const context = getTenantContext();

      // Handle the 'id' alias for 'tenantId'
      if (data === 'id') return context.tenantId;

      // Use a type assertion or explicit mapping to satisfy the compiler
      return data ? context[data as keyof TenantContext] : context;
    } catch (error) {
      throw new ForbiddenException(
        'Tenant context not found. Ensure TenantContextMiddleware is applied.',
      );
    }
  },
);
