// src/common/context/tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tenant Context Interface
 *
 * Contains all information needed to identify and operate on a tenant.
 * Stored in AsyncLocalStorage for automatic propagation through async calls.
 */
export interface TenantContext {
  tenantId: string | null;
  userId: string;
  requestId: string;
  schemaName: string;
  userEmail: string;
  userRole: string;
  timestamp: Date;
}

/**
 * Global AsyncLocalStorage for tenant context.
 *
 * This provides thread-safe context propagation without manual passing.
 */
export const tenantContext = new AsyncLocalStorage<TenantContext>();

/**
 * Get current tenant context.
 *
 * @throws Error if context is not set (fail-fast)
 */
export function getTenantContext(): TenantContext {
  const ctx = tenantContext.getStore();

  if (!ctx) {
    throw new Error(
      'CRITICAL: Tenant context not set. ' +
        'This indicates a bug in middleware or a bypass of authentication. ' +
        'Request must not proceed.',
    );
  }

  return ctx;
}

/**
 * Get tenant ID from current context.
 */
export function getTenantId(): string | null {
  return getTenantContext().tenantId;
}

/**
 * Get schema name from current context.
 */
export function getSchemaName(): string {
  return getTenantContext().schemaName;
}

/**
 * Get user ID from current context.
 */
export function getUserId(): string {
  return getTenantContext().userId;
}

/**
 * Get request ID for correlation logging.
 */
export function getRequestId(): string {
  return getTenantContext().requestId;
}

/**
 * Check if tenant context is set (safe check without throwing).
 */
export function hasTenantContext(): boolean {
  return tenantContext.getStore() !== undefined;
}

/**
 * Set tenant context explicitly for background jobs or cron tasks.
 *
 * CRITICAL: Background jobs MUST call this before accessing tenant data.
 * Failure to set context will result in data leaks or access denied.
 *
 * @param tenantId - Tenant UUID
 * @param userId - User UUID (use 'system' for background jobs)
 * @param requestId - Request ID for correlation (generate with uuidv4())
 * @param schemaName - Schema name (optional, auto-generated if not provided)
 * @param userEmail - User email (use 'system' for background jobs)
 * @param userRole - User role (use 'system' for background jobs)
 * @returns Cleanup function to restore previous context
 *
 * @example
 * const cleanup = setTenantContextForJob(tenantId, 'system', uuidv4());
 * try {
 *   // Do tenant-scoped work
 *   await this.tenantQueryRunner.execute('SELECT * FROM invoices');
 * } finally {
 *   cleanup(); // Always call cleanup
 * }
 */
export function setTenantContextForJob(
  tenantId: string,
  userId: string,
  requestId: string,
  schemaName?: string,
  userEmail: string = 'system',
  userRole: string = 'system',
): () => void {
  const contextData: TenantContext = {
    tenantId,
    userId,
    requestId,
    schemaName: schemaName || `tenant_${tenantId.replace(/-/g, '')}`,
    userEmail,
    userRole,
    timestamp: new Date(),
  };

  // Store previous context for cleanup
  const previousContext = tenantContext.getStore();

  // Set new context
  tenantContext.enterWith(contextData);

  // Return cleanup function
  return () => {
    if (previousContext) {
      tenantContext.enterWith(previousContext);
    } else {
      tenantContext.exit(() => {});
    }
  };
}
