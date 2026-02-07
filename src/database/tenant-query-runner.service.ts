import { Injectable, Logger, Inject, Optional, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { getTenantContext, getRequestId } from '../common/context/tenant-context';
import { QueryHelper } from '../common/database/query-helper';
import { MetricsService } from '../common/metrics/metrics.service';
import { RLSContextService } from './rls-context.service';

@Injectable()
export class TenantQueryRunnerService {
  private readonly logger = new Logger(TenantQueryRunnerService.name);
  private verifiedSchemas = new Set<string>(['public']);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly metrics: MetricsService,
    @Optional()
    @Inject('RLSContextService')
    private readonly rls?: RLSContextService,
  ) {}

  // ===============================
  // CORE SAFE TRANSACTION
  // ===============================

  async transaction<T>(
    work: (runner: QueryRunner) => Promise<T>,
    opts?: { schema?: string; skipSchemaCheck?: boolean },
  ): Promise<T> {
    const start = process.hrtime();
    const requestId = getRequestId();

    const schema = opts?.schema ?? this.resolveSchema();
    const isPublic = schema === 'public';

    if (!isPublic) {
      this.validateSchemaName(schema);

      if (!opts?.skipSchemaCheck) {
        await this.ensureSchemaExists(schema);
      }
    }

    const runner = this.dataSource.createQueryRunner();

    await runner.connect();
    await runner.startTransaction();

    try {
      const searchPath = isPublic ? 'public' : `"${schema}",public`;

      // 🔒 LOCAL ONLY — cannot leak to pool
      await runner.query('SELECT set_config($1, $2, true)', ['search_path', searchPath]);

      if (this.rls) {
        await this.rls.setRLSContext(runner);
      }

      const result = await work(runner);

      await runner.commitTransaction();

      const [s, n] = process.hrtime(start);
      this.metrics.recordSchemaSwitchDuration(schema, s + n / 1e9);

      return result;
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }

      this.logger.error(`[${requestId}] Transaction failed for schema=${schema}: ${err.message}`);

      throw err;
    } finally {
      await runner.release();
    }
  }

  // ===============================
  // SAFE SHORTCUTS
  // ===============================

  async executeTenant<T = any>(query: string, params?: any[]): Promise<T[]> {
    return this.transaction(async (runner) => {
      return runner.query(query, params);
    });
  }

  async executePublic<T = any>(query: string, params?: any[]): Promise<T[]> {
    return this.transaction(async (runner) => runner.query(query, params), { schema: 'public' });
  }

  // ===============================
  // HELPERS
  // ===============================

  private resolveSchema(): string {
    const ctx = getTenantContext();

    if (!ctx) {
      throw new InternalServerErrorException('Tenant context missing');
    }

    return ctx.schemaName || 'public';
  }

  private validateSchemaName(name: string) {
    const pattern = /^tenant_[a-z0-9_]+_[a-z0-9]+$/;

    if (!pattern.test(name)) {
      throw new InternalServerErrorException(`Invalid schema format: ${name}`);
    }
  }

  private async ensureSchemaExists(schema: string) {
    if (this.verifiedSchemas.has(schema)) return;

    const result = await this.dataSource.query(
      `SELECT EXISTS(
         SELECT 1
         FROM information_schema.schemata
         WHERE schema_name = $1
       )`,
      [schema],
    );

    if (!result[0].exists) {
      throw new InternalServerErrorException(`Schema does not exist: ${schema}`);
    }

    this.verifiedSchemas.add(schema);
  }

  async getPublicQueryRunner(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner();

    await runner.connect();

    await runner.query('SELECT set_config($1, $2, false)', ['search_path', 'public']);

    return runner;
  }

  // Add this inside the HELPERS section or near getPublicQueryRunner
  /**
   * Used primarily by E2E tests and provisioning to get a raw QueryRunner.
   * Note: Caller is responsible for calling .release()
   */
  async getRunner(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    return runner;
  }

  /**
   * Backwards-compatible alias used in some E2E tests: execute a query
   * against the public schema via the transaction helper.
   */
  async execute<T = any>(query: string, params?: any[]): Promise<T[]> {
    return this.executePublic(query, params);
  }
}
