// src/database/tenant-query-runner.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { getTenantContext, getSchemaName, getRequestId } from '../common/context/tenant-context';

/**
 * Tenant Query Runner Service
 *
 * THE CORE SERVICE for tenant-scoped database operations.
 *
 * CRITICAL RULES:
 * 1. NEVER use DataSource directly for tenant data
 * 2. ALWAYS use this service for tenant queries
 * 3. ALWAYS release QueryRunner in finally block
 * 4. NEVER cache QueryRunner across requests
 *
 * This service ensures:
 * - Correct schema is set before every query
 * - Connections are properly released
 * - All operations are logged for audit
 */
@Injectable()
export class TenantQueryRunnerService {
  private readonly logger = new Logger(TenantQueryRunnerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get a QueryRunner with search_path set to tenant schema and role switched.
   *
   * CRITICAL: Caller MUST release the runner in a finally block.
   *
   * Example:
   * ```typescript
   * const runner = await this.tenantQueryRunner.getRunner();
   * try {
   *   const result = await runner.query('SELECT * FROM invoices');
   *   return result;
   * } finally {
   *   await runner.release();
   * }
   * ```
   *
   * @returns QueryRunner configured for tenant schema with DB-level isolation
   * @throws Error if tenant context is missing
   * @throws Error if schema validation fails
   */
  async getRunner(): Promise<QueryRunner> {
    const { schemaName, tenantId } = getTenantContext();
    const requestId = getRequestId();

    // Validate schema name format (prevent SQL injection)
    this.validateSchemaName(schemaName);

    // Verify schema exists in database
    await this.verifySchemaExists(schemaName);

    // Create QueryRunner
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    // Set search_path to tenant schema
    // Include 'public' as fallback for pg system functions
    await runner.query(`SET search_path TO ${schemaName}, public`);

    // Switch to tenant role for DB-level isolation
    // This ensures the connection can only access the tenant schema
    await runner.query(`SELECT set_tenant_role()`);

    this.logger.debug(
      `[${requestId}] QueryRunner acquired for ${schemaName} (tenant: ${tenantId}) with role isolation`,
    );

    return runner;
  }

  /**
   * Execute a query with automatic QueryRunner lifecycle management.
   *
   * Preferred for simple queries. Runner is automatically released.
   *
   * @param query SQL query string
   * @param parameters Query parameters (use $1, $2, etc.)
   * @returns Query results
   *
   * Example:
   * ```typescript
   * const invoices = await this.tenantQueryRunner.execute<Invoice>(
   *   'SELECT * FROM invoices WHERE status = $1',
   *   ['paid']
   * );
   * ```
   */
  async execute<T = any>(query: string, parameters?: any[]): Promise<T[]> {
    const runner = await this.getRunner();
    const requestId = getRequestId();

    try {
      this.logger.debug(`[${requestId}] Executing query: ${query.substring(0, 100)}...`);

      const result = await runner.query(query, parameters);

      this.logger.debug(`[${requestId}] Query returned ${result?.length || 0} rows`);

      return result;
    } catch (error) {
      this.logger.error(`[${requestId}] Query failed: ${error.message}`, error.stack);
      throw error;
    } finally {
      await runner.release();
      this.logger.debug(`[${requestId}] QueryRunner released`);
    }
  }

  /**
   * Execute a transaction with automatic rollback on error.
   *
   * Use this for operations that modify data.
   *
   * @param work Function that receives QueryRunner and returns result
   * @returns Result from work function
   *
   * Example:
   * ```typescript
   * const invoice = await this.tenantQueryRunner.transaction(async (runner) => {
   *   const result = await runner.query(
   *     'INSERT INTO invoices (...) VALUES (...) RETURNING *',
   *     [...]
   *   );
   *   return result[0];
   * });
   * ```
   */
  async transaction<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = await this.getRunner();
    const requestId = getRequestId();

    try {
      await runner.startTransaction();
      this.logger.debug(`[${requestId}] Transaction started`);

      const result = await work(runner);

      await runner.commitTransaction();
      this.logger.debug(`[${requestId}] Transaction committed`);

      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      this.logger.error(`[${requestId}] Transaction rolled back: ${error.message}`, error.stack);
      throw error;
    } finally {
      await runner.release();
      this.logger.debug(`[${requestId}] QueryRunner released`);
    }
  }

  /**
   * Validate schema name format.
   *
   * Prevents SQL injection via malicious schema names.
   *
   * Valid format: tenant_<32 hex chars>
   * Example: tenant_a1b2c3d4e5f6...
   */
  private validateSchemaName(schemaName: string): void {
    const validPattern = /^tenant_[a-f0-9]{32}$/;

    if (!validPattern.test(schemaName)) {
      this.logger.error(`Invalid schema name format: ${schemaName}`);
      throw new Error(
        `Invalid schema name: ${schemaName}. ` + `This indicates a bug or security issue.`,
      );
    }
  }

  /**
   * Verify schema exists in database.
   *
   * Prevents queries against non-existent schemas.
   */
  private async verifySchemaExists(schemaName: string): Promise<void> {
    const result = await this.dataSource.query(
      `SELECT EXISTS(
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = $1
      ) as exists`,
      [schemaName],
    );

    if (!result[0].exists) {
      this.logger.error(`Schema does not exist: ${schemaName}`);
      throw new Error(
        `Schema ${schemaName} does not exist. ` + `Tenant data may have been deleted or corrupted.`,
      );
    }
  }

  /**
   * Get current schema name (for debugging).
   */
  async getCurrentSchema(): Promise<string> {
    const result = await this.dataSource.query('SHOW search_path');
    return result[0].search_path;
  }
}
