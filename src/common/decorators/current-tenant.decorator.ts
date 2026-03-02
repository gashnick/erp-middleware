import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getTenantContext } from '@common/context/tenant-context';

/** Pull tenantId directly from AsyncLocalStorage — safe in HTTP and GraphQL contexts. */
export const CurrentTenantId = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string => {
    const context = getTenantContext();
    if (!context?.tenantId) throw new Error('No tenant context');
    return context.tenantId;
  },
);

/** Pull the full tenant context object. */
export const CurrentTenant = createParamDecorator((_data: unknown, _ctx: ExecutionContext) =>
  getTenantContext(),
);

/** Pull userId from AsyncLocalStorage. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string => {
    const context = getTenantContext();
    if (!context?.userId) throw new Error('No user context');
    return context.userId;
  },
);
