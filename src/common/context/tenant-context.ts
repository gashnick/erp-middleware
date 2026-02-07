// src/common/context/tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

/**
 * User roles in the system
 *
 * 🛡️ CRITICAL: Use specific system roles for privilege minimization.
 * Never use generic 'SYSTEM' - always specify which system component is acting.
 */
export enum UserRole {
  // Regular user roles
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  ANALYST = 'ANALYST',
  VIEWER = 'VIEWER',

  // System roles (use for background jobs, migrations, etc.)
  SYSTEM_MIGRATION = 'SYSTEM_MIGRATION', // Can only run migrations
  SYSTEM_JOB = 'SYSTEM_JOB', // Can execute scheduled jobs
  SYSTEM_READONLY = 'SYSTEM_READONLY', // Can only read data (backups, analytics)
  SYSTEM_MAINTENANCE = 'SYSTEM_MAINTENANCE', // Can perform maintenance tasks
}

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
  userRole: UserRole | string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

/**
 * Global AsyncLocalStorage for tenant context.
 * Provides thread-safe context propagation without manual passing.
 */
export const tenantContext = new AsyncLocalStorage<TenantContext>();

/**
 * Get current tenant context.
 *
 * 🛡️ CRITICAL: Fails fast if context is missing.
 * Background tasks MUST call setTenantContextForJob() or runWithTenantContext() first.
 *
 * @throws Error if context is not set
 */
export function getTenantContext(): TenantContext {
  const ctx = tenantContext.getStore();
  if (!ctx) {
    throw new Error(
      'Tenant context not set. ' +
        'Tenant context missing. Background tasks must call setTenantContextForJob() or runWithTenantContext(). ' +
        'HTTP requests must pass through TenantContextMiddleware.',
    );
  }
  return ctx;
}

/** Shortcut getters for tenant context */
export function getTenantId(): string | null {
  return getTenantContext().tenantId;
}

export function getSchemaName(): string {
  return getTenantContext().schemaName;
}

export function getUserId(): string {
  return getTenantContext().userId;
}

export function getRequestId(): string {
  return getTenantContext().requestId;
}

export function hasTenantContext(): boolean {
  return tenantContext.getStore() !== undefined;
}

/**
 * Set tenant context explicitly for background jobs or cron tasks.
 * Returns a cleanup function to restore previous context.
 *
 * 🛡️ PRIVILEGE MINIMIZATION: Use the most restrictive SYSTEM_* role for the job.
 */
export function setTenantContextForJob(
  tenantId: string,
  userId: string,
  requestId: string,
  schemaName?: string,
  userEmail: string = 'system@internal',
  userRole: string = UserRole.SYSTEM_JOB,
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

  // Capture current context for restoration
  const previousContext = tenantContext.getStore();

  // Set new context for current execution
  tenantContext.enterWith(contextData);

  // Return cleanup function
  return () => {
    // Restore previous context exactly. If `previousContext` is defined,
    // re-enter it. If it's `undefined` (no previous context), attempt to
    // restore previous context if present
    if (previousContext !== undefined) {
      tenantContext.enterWith(previousContext);
      return;
    }

    // If there was no previous context, clear the store. Tests use
    // `tenantContext.exit(() => {})` to clear AsyncLocalStorage; use the
    // same operation which is supported and reliably clears the store.
    try {
      tenantContext.exit(() => {});
    } catch {
      // Fallback: if exit isn't available or fails, try enterWith(undefined)
      // for Node versions that support it. If that also fails, there's not
      // much we can do — leave the store as-is (best-effort).
      try {
        (tenantContext as any).enterWith(undefined);
      } catch {
        // no-op
      }
    }
  };
}

/**
 * Run an async callback within a specific tenant context.
 * Ensures previous context is restored after callback finishes.
 */
export async function runWithTenantContext<T>(
  partialContext: Partial<TenantContext> & {
    tenantId: string;
    userId: string;
    userRole?: UserRole | string;
  },
  callback: () => Promise<T>,
): Promise<T> {
  if (!partialContext || !partialContext.tenantId) {
    throw new Error('Tenant ID is required');
  }
  if (!partialContext.userId) {
    throw new Error('User ID is required');
  }

  const contextData: TenantContext = {
    tenantId: partialContext.tenantId,
    userId: partialContext.userId,
    requestId: partialContext.requestId || `internal-${Date.now()}`,
    schemaName: partialContext.schemaName || `tenant_${partialContext.tenantId.replace(/-/g, '')}`,
    userEmail: partialContext.userEmail || 'system@internal',
    userRole: partialContext.userRole || UserRole.SYSTEM_JOB,
    timestamp: new Date(),
    ipAddress: partialContext.ipAddress || '127.0.0.1',
    userAgent: partialContext.userAgent || 'Internal-Task-Runner',
  };

  // Run the callback inside the tenant context
  return tenantContext.run(contextData, callback);
}
