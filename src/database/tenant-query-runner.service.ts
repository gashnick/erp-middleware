// src/database/tenant-query-runner.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { getTenantContext, getSchemaName, getRequestId } from '../common/context/tenant-context';

/**
 * Tenant Query Runner Service
 * * THE CORE SERVICE for tenant-scoped database operations.
 * Updated to support 'public' schema for auth/onboarding flows.
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
   */
  async getRunner(): Promise<QueryRunner> {
    const { schemaName, tenantId } = getTenantContext();
    const requestId = getRequestId();

    // Check if we are operating in the shared public schema (Signup/Login)
    const isPublic = schemaName === 'public';

    // Validate and verify ONLY if it is a tenant-specific schema
    if (!isPublic) {
      this.validateSchemaName(schemaName);
      await this.verifySchemaExists(schemaName);
    }

    // Create QueryRunner
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    // Set search_path: If public, just 'public'. If tenant, 'tenant_xxx, public'
    const searchPath = isPublic ? 'public' : `${schemaName}, public`;
    await runner.query(`SET search_path TO ${searchPath}`);

    // Switch to tenant role for DB-level isolation ONLY for tenants
    // Public registration needs the standard app role to write to public.users
    // if (!isPublic) {
    //   await runner.query(`SELECT set_tenant_role()`);
    // }

    this.logger.debug(
      `[${requestId}] QueryRunner acquired for ${schemaName} (Mode: ${isPublic ? 'PUBLIC' : 'TENANT'})`,
    );

    return runner;
  }

  /**
   * Execute a query with automatic QueryRunner lifecycle management.
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
   * Helper to get tenant metadata from public schema
   */
  private async getTenantMetadata(tenantId: string) {
    const [tenant] = await this.dataSource.query(
      `SELECT schema_name FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    return tenant;
  }

  /**
   * Execute a transaction with automatic rollback on error.
   */
  /**
   * Execute a transaction with automatic rollback on error.
   * Updated to optionally accept tenantId for background tasks/ETL.
   */
  async transaction<T>(
    work: (runner: QueryRunner) => Promise<T>,
    tenantId?: string, // <--- Add this optional parameter
  ): Promise<T> {
    // If a tenantId is passed explicitly (like from EtlService),
    // we could potentially fetch the schema name here if it's not in context.
    // But for now, we'll keep using getRunner() which pulls from Context.

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
   * Now allows 'public' as a valid schema name.
   */
  private validateSchemaName(schemaName: string): void {
    if (schemaName === 'public') return;

    // Allows 'tenant_' followed by alphanumeric characters and underscores
    // This covers: tenant_acme_erp_corp_b0c49559
    const validPattern = /^tenant_[a-z0-9_]+$/;

    if (!validPattern.test(schemaName)) {
      this.logger.error(`Invalid schema name format: ${schemaName}`);
      throw new Error(`Invalid schema name: ${schemaName}.`);
    }
  }

  /**
   * Verify schema exists in database.
   */
  private async verifySchemaExists(schemaName: string): Promise<void> {
    if (schemaName === 'public') return;

    const result = await this.dataSource.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) as exists`,
      [schemaName],
    );

    if (!result[0].exists) {
      this.logger.error(`Schema does not exist: ${schemaName}`);
      throw new Error(`Schema ${schemaName} does not exist.`);
    }
  }

  async getCurrentSchema(): Promise<string> {
    const result = await this.dataSource.query('SHOW search_path');
    return result[0].search_path;
  }
}
