import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { getTenantContext, getRequestId } from '../common/context/tenant-context';
import { QueryHelper } from '../common/database/query-helper';
import { MetricsService } from '../common/metrics/metrics.service';
import { RLSContextService } from './rls-context.service';

@Injectable()
export class TenantQueryRunnerService {
  private readonly logger = new Logger(TenantQueryRunnerService.name);

  // Cache verified schemas to avoid redundant information_schema lookups
  private verifiedSchemas = new Set<string>(['public']);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly metricsService: MetricsService,
    @Optional()
    @Inject('RLSContextService')
    private readonly rlsContext?: RLSContextService,
  ) {}

  /**
   * High-performance UPSERT that bypasses TypeORM Entity metadata.
   * Use this for batch processing in dynamic tenant schemas.
   */
  async upsert(
    runner: QueryRunner,
    tableName: string,
    data: any[],
    conflictPaths: string[],
    updateColumns: string[],
  ): Promise<any[]> {
    const { query, parameters } = QueryHelper.buildUpsert(
      tableName,
      data,
      conflictPaths,
      updateColumns,
    );

    if (!query) return [];
    return await runner.query(query, parameters);
  }

  /**
   * Acquires a QueryRunner and configures the PostgreSQL search_path
   * based on the current Tenant Context. Includes performance monitoring.
   *
   * 🛡️ CRITICAL: Fails fast if tenant context is missing.
   * DB access without context is a critical security bug.
   *
   * 🛡️ CRITICAL: Sets RLS context (app.tenant_id) for DB-level isolation.
   *
   * @throws Error if tenant context is missing
   * @returns Configured QueryRunner
   */
  async getRunner(): Promise<QueryRunner> {
    const start = process.hrtime(); // Start high-precision timer
    const context = getTenantContext();
    const requestId = getRequestId();

    // 🛡️ SECURITY: Fail fast if context is missing
    // Allow access to public schema for public routes (like user registration)
    if (!context || (!context.tenantId && context.schemaName !== 'public')) {
      this.logger.error(
        `[${requestId}] CRITICAL: Database access attempted without tenant context`,
      );
      throw new Error(
        'Database access requires tenant context. Ensure TenantContextMiddleware is applied and tenant is authenticated.',
      );
    }

    const { schemaName, tenantId } = context;
    const isPublic = !schemaName || schemaName === 'public';
    const targetSchema = isPublic ? 'public' : schemaName;

    try {
      if (!isPublic) {
        this.validateSchemaName(targetSchema);
        await this.ensureSchemaExists(targetSchema);
      }

      const runner = this.dataSource.createQueryRunner();
      await runner.connect();

      // Set search_path so local tables are found first, then public tables
      const searchPath = isPublic ? 'public' : `"${targetSchema}", public`;
      await runner.query(`SET search_path TO ${searchPath}`);

      // 🛡️ CRITICAL: Set RLS context for database-level tenant isolation
      if (this.rlsContext) {
        await this.rlsContext.setRLSContext(runner);
      }

      // Record metrics: Calculate duration in seconds
      const [seconds, nanoseconds] = process.hrtime(start);
      const duration = seconds + nanoseconds / 1e9;
      this.metricsService.recordSchemaSwitchDuration(tenantId || 'system', duration);

      this.logger.debug(
        `[${requestId}] Connection established for: ${
          isPublic ? 'PUBLIC' : targetSchema
        } with RLS context in ${(duration * 1000).toFixed(2)}ms`,
      );

      return runner;
    } catch (error) {
      this.logger.error(
        `[${requestId}] Failed to acquire runner for ${targetSchema}: ${error.message}`,
      );
      throw error;
    }
  }

  private async ensureSchemaExists(schemaName: string): Promise<void> {
    if (this.verifiedSchemas.has(schemaName)) return;

    const result = await this.dataSource.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) as exists`,
      [schemaName],
    );

    if (!result[0].exists) {
      this.logger.error(
        `[INTERNAL] Schema verification failed. Rejecting database access. Schema: (redacted)`,
      );
      // 🛡️ CRITICAL: Generic error message - never reveal schema name to client
      throw new Error('Database operation failed');
    }

    this.verifiedSchemas.add(schemaName);
  }

  private validateSchemaName(schemaName: string): void {
    const validPattern = /^tenant_[a-z0-9_]+$/;
    if (!validPattern.test(schemaName)) {
      throw new Error(`Invalid schema name format: ${schemaName}`);
    }
  }

  /**
   * Executes a one-off query within the tenant context.
   *
   * 🛡️ CRITICAL: Each call gets fresh schema isolation through search_path.
   * Parameterized queries prevent SQL injection.
   */
  async execute<T = any>(query: string, parameters?: any[]): Promise<T[]> {
    const runner = await this.getRunner();
    try {
      return await runner.query(query, parameters);
    } finally {
      await runner.release();
    }
  }

  /**
   * Wraps multiple operations in a single database transaction.
   *
   * 🛡️ CRITICAL: Uses SET LOCAL search_path to isolate schema within transaction.
   * This prevents schema leakage to concurrent requests.
   * search_path is transaction-scoped, not connection-scoped.
   */
  async transaction<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = await this.getRunner();
    const context = getTenantContext();
    const requestId = getRequestId();
    const { schemaName } = context;
    const isPublic = !schemaName || schemaName === 'public';
    const targetSchema = isPublic ? 'public' : schemaName;

    try {
      await runner.startTransaction();

      // 🛡️ CRITICAL: Use SET LOCAL to isolate search_path to this transaction only
      // This is transaction-scoped, not connection-scoped, so it won't leak to other requests
      const searchPath = isPublic ? 'public' : `"${targetSchema}", public`;
      await runner.query(`SET LOCAL search_path TO ${searchPath}`);

      const result = await work(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      this.logger.error(`[${requestId}] Transaction failed: ${error.message}`);
      throw error;
    } finally {
      await runner.release();
    }
  }

  /**
   * Helper for operations that require the TypeORM EntityManager
   */
  async runInTenantContext<T>(
    work: (entityManager: QueryRunner['manager']) => Promise<T>,
  ): Promise<T> {
    const runner = await this.getRunner();
    try {
      return await work(runner.manager);
    } finally {
      await runner.release();
    }
  }
}
