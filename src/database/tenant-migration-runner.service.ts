// src/database/tenant-migration-runner.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { readdirSync } from 'fs';
import { join } from 'path';

interface MigrationRecord {
  id: number;
  name: string;
  timestamp: number;
  executed_at: Date;
}

/**
 * Tenant Migration Runner Service
 *
 * Runs migrations for tenant schemas.
 *
 * Migrations are:
 * - Idempotent (safe to run multiple times)
 * - Tracked per schema in migrations table
 * - Applied in timestamp order
 *
 * Usage:
 * - On tenant creation: runMigrations(schemaName)
 * - On startup: runMigrationsForAllTenants()
 * - On demand: Admin endpoint
 */
@Injectable()
export class TenantMigrationRunnerService {
  private readonly logger = new Logger(TenantMigrationRunnerService.name);
  private readonly migrationDir = join(__dirname, 'migrations/tenant');

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Run all pending migrations for a tenant schema.
   *
   * Safe to run multiple times (idempotent).
   *
   * @param schemaName - Tenant schema name (e.g., 'tenant_abc123')
   */
  async runMigrations(schemaName: string): Promise<{
    executed: string[];
    skipped: string[];
    errors: string[];
  }> {
    this.logger.log(`Running migrations for schema: ${schemaName}`);

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    const result: {
      executed: string[];
      skipped: string[];
      errors: string[];
    } = {
      executed: [],
      skipped: [],
      errors: [],
    };

    try {
      // Set schema
      await runner.query(`SET search_path TO ${schemaName}, public`);

      // Ensure migrations table exists
      await this.ensureMigrationsTable(runner, schemaName);

      // Get executed migrations
      const executed = await this.getExecutedMigrations(runner);
      const executedNames = new Set(executed.map((m) => m.name));

      // Get migration files
      const files = this.getMigrationFiles();

      for (const file of files) {
        const migrationName = file.replace(/\.(ts|js)$/, '');

        if (executedNames.has(migrationName)) {
          this.logger.debug(`⏭️  Skipping ${migrationName} (already executed)`);
          result.skipped.push(migrationName);
          continue;
        }

        try {
          this.logger.log(`▶️  Running ${migrationName}`);

          // Load migration
          const migration = require(join(this.migrationDir, file));
          const instance = new migration.default();

          // Execute in transaction
          await runner.startTransaction();
          try {
            await instance.up(runner);

            // Record migration
            await runner.query(
              `INSERT INTO migrations (name, timestamp, executed_at) 
               VALUES ($1, $2, NOW())`,
              [migrationName, Date.now()],
            );

            await runner.commitTransaction();
            this.logger.log(`✅ ${migrationName}`);
            result.executed.push(migrationName);
          } catch (error) {
            await runner.rollbackTransaction();
            throw error;
          }
        } catch (error) {
          this.logger.error(`❌ ${migrationName} failed: ${error.message}`);
          result.errors.push(`${migrationName}: ${error.message}`);
          // Continue with next migration
        }
      }

      this.logger.log(
        `Migrations complete for ${schemaName}: ` +
          `${result.executed.length} executed, ` +
          `${result.skipped.length} skipped, ` +
          `${result.errors.length} errors`,
      );
    } finally {
      await runner.release();
    }

    return result;
  }

  /**
   * Run migrations for all tenant schemas.
   *
   * Call on application startup.
   */
  async runMigrationsForAllTenants(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Record<string, any>;
  }> {
    this.logger.log('Running migrations for all tenants...');

    // Get all tenant schemas
    const schemas = await this.getAllTenantSchemas();
    this.logger.log(`Found ${schemas.length} tenant schemas`);

    const results: Record<string, any> = {};
    let succeeded = 0;
    let failed = 0;

    for (const schema of schemas) {
      try {
        const result = await this.runMigrations(schema);
        results[schema] = result;

        if (result.errors.length === 0) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        this.logger.error(`Failed to migrate ${schema}: ${error.message}`);
        results[schema] = { error: error.message };
        failed++;
      }
    }

    this.logger.log(
      `All tenant migrations complete: ` + `${succeeded} succeeded, ${failed} failed`,
    );

    return {
      total: schemas.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Get migration status for a tenant.
   */
  async getMigrationStatus(schemaName: string): Promise<{
    executed: MigrationRecord[];
    pending: string[];
    available: string[];
  }> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      await runner.query(`SET search_path TO ${schemaName}, public`);
      await this.ensureMigrationsTable(runner, schemaName);

      const executed = await this.getExecutedMigrations(runner);
      const executedNames = new Set(executed.map((m) => m.name));

      const available = this.getMigrationFiles().map((f) => f.replace(/\.(ts|js)$/, ''));

      const pending = available.filter((name) => !executedNames.has(name));

      return { executed, pending, available };
    } finally {
      await runner.release();
    }
  }

  /**
   * Ensure migrations table exists in schema.
   */
  private async ensureMigrationsTable(runner: QueryRunner, schemaName: string): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        timestamp BIGINT NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * Get executed migrations from migrations table.
   */
  private async getExecutedMigrations(runner: QueryRunner): Promise<MigrationRecord[]> {
    return runner.query('SELECT * FROM migrations ORDER BY timestamp ASC');
  }

  /**
   * Get all tenant schemas from database.
   */
  private async getAllTenantSchemas(): Promise<string[]> {
    const result = (await this.dataSource.query(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name LIKE 'tenant_%'
       ORDER BY schema_name`,
    )) as { schema_name: string }[];

    return result.map((r) => r.schema_name);
  }

  /**
   * Get migration files from disk.
   */
  private getMigrationFiles(): string[] {
    try {
      return readdirSync(this.migrationDir)
        .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
        .sort(); // Sort by name (timestamp prefix ensures correct order)
    } catch (error) {
      this.logger.error(`Failed to read migration directory: ${error.message}`);
      return [];
    }
  }
}
