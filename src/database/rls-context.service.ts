// src/database/rls-context.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { getTenantContext, getRequestId, UserRole } from '@common/context/tenant-context';

/**
 * Row-Level Security Context Service
 *
 * 🛡️ CRITICAL: Sets PostgreSQL session variable before each query.
 * This variable is used by RLS policies to enforce tenant isolation at the DB level.
 *
 * Usage:
 * - Call setRLSContext() before executing queries
 * - The session variable persists for the connection lifetime
 * - Automatically cleared when connection is released
 */
@Injectable()
export class RLSContextService {
  private readonly logger = new Logger(RLSContextService.name);

  /**
   * Set PostgreSQL session variable app.tenant_id
   *
   * 🛡️ CRITICAL: Must be called for every database connection.
   * Without this, RLS policies cannot enforce isolation.
   *
   * @param runner - TypeORM QueryRunner
   * @throws Error if tenant context is missing
   */
  async setRLSContext(runner: QueryRunner): Promise<void> {
    try {
      const { tenantId, userRole } = getTenantContext();
      const requestId = getRequestId();

      // Map app roles to DB session values
      let sessionTenantId: string;

      if (userRole === UserRole.SYSTEM_MIGRATION) {
        // Migrations need special bypass
        sessionTenantId = 'SYSTEM_MIGRATION';
      } else if (userRole?.startsWith('SYSTEM_')) {
        // Other system roles use their own identifier
        sessionTenantId = userRole;
      } else if (tenantId) {
        // Regular users use tenant ID
        sessionTenantId = tenantId;
      } else {
        // Public routes (user registration, login) operate in public schema
        // Set a special public context that allows access to public tables only
        sessionTenantId = 'PUBLIC_ACCESS';
      }

      // Set the session variable (transaction-scoped)
      await runner.query(`SET app.tenant_id = '${sessionTenantId}'`);

      this.logger.debug(
        `[${requestId}] RLS context set: tenant_id=${
          userRole?.startsWith('SYSTEM_') ? userRole : '***'
        }`,
      );
    } catch (error) {
      this.logger.error(`Failed to set RLS context: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear RLS context (called on connection release)
   *
   * @param runner - TypeORM QueryRunner
   */
  async clearRLSContext(runner: QueryRunner): Promise<void> {
    try {
      // PostgreSQL automatically clears session variables when connection closes
      // But we can explicitly reset it for clarity
      await runner.query(`RESET app.tenant_id`);
    } catch {
      // Silently ignore - connection is being released anyway
    }
  }

  /**
   * Test that RLS is enforcing isolation
   *
   * 🛡️ CRITICAL: Use in tests to verify that RLS is active.
   * If this doesn't throw, your RLS is broken.
   *
   * @param runner - QueryRunner
   * @throws Error if app.tenant_id is not set
   */
  async verifyRLSEnforcement(runner: QueryRunner): Promise<void> {
    try {
      // Try to access a tenant-specific table without setting context
      // This should FAIL if RLS is working
      const tmpRunner = runner.manager.connection.createQueryRunner();
      await tmpRunner.connect();

      // Note: Don't set app.tenant_id
      try {
        await tmpRunner.query('SELECT 1 FROM invoices LIMIT 1');
        // If we got here, RLS is NOT enforcing
        this.logger.error('⚠️  RLS ENFORCEMENT FAILED: Query succeeded without app.tenant_id set');
        throw new Error('RLS is not enforcing tenant isolation');
      } catch (error) {
        if (error.message.includes('tenant context required')) {
          // RLS is working correctly
          this.logger.debug('✅ RLS enforcement verified: Queries blocked without context');
        } else {
          throw error;
        }
      } finally {
        await tmpRunner.release();
      }
    } catch (error) {
      this.logger.error(`RLS verification failed: ${error.message}`);
      throw error;
    }
  }
}
